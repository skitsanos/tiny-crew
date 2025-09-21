import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import {
    type AgentConfig,
    AgentEvent,
    type ConversationMessage,
    type LlmConfig,
    type SharedMemory,
    type Task,
    type TaskError,
    type TaskResult, TaskStatus,
    type Tool
} from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';
import dedent from 'dedent';
import type {
    Response,
    ResponseFunctionToolCall,
    ResponseInputItem,
    ResponseOutputMessage
} from 'openai/resources/responses/responses';
import { withRetry } from '@/utils/retry.ts';

/**
 * Enhanced Agent class with improved state management and tool handling
 */
export class Agent extends EventEmitter {
    private readonly id: string;
    private readonly name: string;
    private readonly goal: string;
    private readonly expectedOutput?: string;
    private readonly systemPrompt: string;
    private readonly capabilities: string[];
    private readonly llmConfig: LlmConfig;
    private readonly tools: Map<string, Tool>;
    private readonly logger: Logger;
    private readonly client: OpenAI;
    private taskHistory: Map<string, Task>;

    /**
     * Create a new Agent instance
     */
    constructor(config: AgentConfig, client: OpenAI, tools: Tool[] = []) {
        super();
        this.id = randomUUID();
        this.name = config.name;
        this.goal = config.goal;
        this.expectedOutput = config.expectedOutput;
        this.systemPrompt = config.systemPrompt || this.buildDefaultSystemPrompt();
        this.capabilities = config.capabilities || [];
        this.llmConfig = {
            model: config.model || 'gpt-4o-mini',
            temperature: config.temperature || 0.7,
            maxTokens: config.maxTokens || 1024
        };
        this.client = client;
        this.tools = new Map(tools.map(tool => [tool.name, tool]));
        this.taskHistory = new Map();
        this.logger = new Logger(`Agent-${this.name}`);

        // Register default event handlers
        this.on(AgentEvent.TASK_COMPLETED, this.handleTaskComplete.bind(this));
        this.on(AgentEvent.TASK_FAILED, this.handleTaskError.bind(this));
    }

    /**
     * Build the default system prompt if none provided
     */
    private buildDefaultSystemPrompt(): string {
        return `You are ${this.name}, an AI assistant with the goal: ${this.goal}.
    
Your responses should be helpful, harmless, and honest.

${this.expectedOutput ? `Expected output format: ${this.expectedOutput}` : ''}`;
    }

    /**
     * Get the agent's unique ID
     */
    getId(): string {
        return this.id;
    }

    /**
     * Get the agent's name
     */
    getName(): string {
        return this.name;
    }

    /**
     * Get the agent's goal
     */
    getGoal(): string {
        return this.goal;
    }

    /**
     * Get the agent's expected output format
     */
    getExpectedOutput(): string | undefined {
        return this.expectedOutput;
    }

    /**
     * Get the agent's capabilities
     */
    getCapabilities(): string[] {
        return [...this.capabilities];
    }

    /**
     * Get all tools available to this agent
     */
    getTools(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Check if the agent has a specific tool
     */
    hasTool(toolName: string): boolean {
        return this.tools.has(toolName);
    }

    /**
     * Add a new tool to the agent
     */
    addTool(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * Remove a tool from the agent
     */
    removeTool(toolName: string): boolean {
        return this.tools.delete(toolName);
    }

    /**
     * Get a task by ID
     */
    getTask(taskId: string): Task | undefined {
        return this.taskHistory.get(taskId);
    }

    /**
     * Get all tasks
     */
    getTasks(): Task[] {
        return Array.from(this.taskHistory.values());
    }

    /**
     * Handle task completion event
     */
    private handleTaskComplete(result: TaskResult): void {
        this.logger.info(`Task completed: ${result.task}`);
    }

    /**
     * Handle task error event
     */
    private handleTaskError(error: TaskError): void {
        this.logger.error(`Task failed: ${error.task}`, error.error);
    }

    /**
     * Generate a task ID
     */
    private generateTaskId(taskDescription: string): string {
        return `task_${randomUUID().split('-')[0]}_${taskDescription.slice(0, 20).replace(/\W+/g, '_')}`;
    }

    /**
     * Create a new task object
     */
    private createTask(description: string): Task {
        const taskId = this.generateTaskId(description);
        const now = Date.now();

        const task: Task = {
            id: taskId,
            description,
            status: TaskStatus.PENDING,
            assignedAgent: this.name,
            createdAt: now,
            updatedAt: now
        };

        this.taskHistory.set(taskId, task);
        return task;
    }

    /**
     * Update task status
     */
    private updateTaskStatus(taskId: string, status: TaskStatus, result?: string, error?: Error): void {
        const task = this.taskHistory.get(taskId);
        if (task) {
            task.status = status;
            task.updatedAt = Date.now();

            if (result !== undefined) {
                task.result = result;
            }

            if (error !== undefined) {
                task.error = error;
            }

            this.taskHistory.set(taskId, task);
        }
    }

    /**
     * Execute a tool by name with provided arguments
     */
    private async executeTool(toolName: string, args: any): Promise<any> {
        const tool = this.tools.get(toolName);

        if (!tool) {
            throw new Error(`Tool ${toolName} not found`);
        }

        this.logger.debug(`Executing tool ${toolName} with args:`, args);

        // Validate input if the tool has a validator
        if (tool.validateInput && !await tool.validateInput(args)) {
            throw new Error(`Invalid arguments for tool ${toolName}`);
        }

        // Execute the tool
        try {
            const result = await tool.use(args);
            this.emit(AgentEvent.TOOL_USED, {
                agent: this.name,
                tool: toolName,
                args,
                result,
                timestamp: Date.now()
            });
            return result;
        } catch (error) {
            this.logger.error(`Error executing tool ${toolName}:`, error);
            throw error;
        }
    }

    private buildMessage(role: 'system' | 'user' | 'developer', content: string): ResponseInputItem {
        return {
            type: 'message',
            role,
            content: [
                {
                    type: 'input_text',
                    text: content
                }
            ]
        };
    }

    private buildAssistantOutput(content: string): ResponseOutputMessage {
        return {
            id: `msg_${randomUUID()}`,
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [
                {
                    type: 'output_text',
                    text: content,
                    annotations: [],
                    logprobs: []
                }
            ]
        };
    }

    private toResponseInputItem(message: ConversationMessage): ResponseInputItem {
        if (message.role === 'assistant') {
            return this.buildAssistantOutput(message.content);
        }

        if (message.role === 'developer') {
            return this.buildMessage('developer', message.content);
        }

        return this.buildMessage(message.role, message.content);
    }

    private buildResponsesToolDefinitions(): Array<any> {
        return Array.from(this.tools.values()).map(tool => ({
            type: 'function',
            name: tool.schema.name,
            description: tool.schema.description,
            parameters: {
                ...tool.schema.parameters,
                additionalProperties: false
            },
            strict: true
        }));
    }

    private buildChatToolDefinitions(): Array<{ type: 'function'; function: any }> {
        return Array.from(this.tools.values()).map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.schema.name,
                description: tool.schema.description,
                parameters: tool.schema.parameters
            }
        }));
    }

    private buildToolInstruction(): string {
        const instructions: string[] = [];

        this.tools.forEach(tool => {
            const required = tool.schema.parameters.required ?? [];
            const properties = Object.entries(tool.schema.parameters.properties ?? {})
                .map(([key, value]) => {
                    const requiredFlag = required.includes(key) ? ' (required)' : '';
                    return `- ${key}${requiredFlag}: ${value.description ?? 'no description provided'}`;
                })
                .join('\n');

            instructions.push(`Tool ${tool.schema.name}: ${tool.description}\nParameters:\n${properties}`);
        });

        instructions.push('When calling a tool, always provide valid JSON arguments for every required parameter.');

        if (this.tools.has('FileWrite'))
        {
            instructions.push(
                'When a task requires writing or saving content, you MUST call the FileWrite tool with a JSON object containing "filename" (including any directories) and "content" (the full text to write). Do not claim that a file was written unless the FileWrite tool call succeeds.'
            );
            instructions.push('Example: {"name":"FileWrite","arguments":{"filename":"output/report.md","content":"# Report"}}');
        }

        instructions.push('After receiving tool outputs, you should incorporate their results and produce a final assistant message.');

        return instructions.join('\n\n');
    }


    private async createResponse(
        conversation: ResponseInputItem[],
        allowTools: boolean
    ): Promise<Response> {
        const request: Record<string, any> = {
            model: this.llmConfig.model,
            input: conversation,
            temperature: this.llmConfig.temperature
        };

        if (this.llmConfig.maxTokens) {
            request.max_output_tokens = this.llmConfig.maxTokens;
        }

        if (allowTools && this.tools.size > 0) {
            const tools = this.buildResponsesToolDefinitions();
            this.logger.info(`Adding ${tools.length} tools to request`);
            this.logger.debug(`Tools definition:`, JSON.stringify(tools, null, 2));
            request.tools = tools;
            request.tool_choice = "auto";
        }

        this.logger.debug(`Full request:`, JSON.stringify(request, null, 2));
        this.logger.info(`Making responses.create call...`);

        return await withRetry(
            () => this.client.responses.create(request),
            this.logger,
            `responses.create (${this.name})`
        );
    }

    private async runResponseWorkflow(conversation: ResponseInputItem[], taskDescription: string = ''): Promise<{ text: string; response: Response; toolsUsed: string[] }> {
        const toolsUsed: string[] = [];

        this.logger.info(`Starting response workflow with ${this.tools.size} tools available`);

        // Step 1: Get initial response with potential tool calls
        const response = await this.createResponse(conversation, this.tools.size > 0);

        this.logger.info(`Got initial response, checking for tool calls...`);

        // Step 2: Extract tool calls from the response
        this.logger.debug(`Full response output:`, JSON.stringify(response.output, null, 2));

        const toolCalls: any[] = [];
        for (const item of response.output ?? []) {
            this.logger.debug(`Response output item:`, { type: item.type, id: (item as any).id, name: (item as any).name });
            if (item.type === "function_call") {
                this.logger.debug(`Found function call:`, item);
                // Convert Responses API format to Chat Completions format for compatibility
                toolCalls.push({
                    id: (item as any).call_id,
                    function: {
                        name: (item as any).name,
                        arguments: (item as any).arguments
                    }
                });
            }
        }

        this.logger.info(`Extracted ${toolCalls.length} tool calls from response`);

        // Step 3: If no tools called, return the response immediately
        if (toolCalls.length === 0) {
            this.logger.warn(`No tool calls found! Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
            return {
                text: this.extractTextFromResponse(response),
                response,
                toolsUsed
            };
        }

        this.logger.info(`Found ${toolCalls.length} tool calls to execute`);

        // Step 4: Execute all tool calls and prepare outputs
        const tool_outputs = await Promise.all(
            toolCalls.map(async (tc) => {
                const args = this.safeParseJson(tc.function.arguments);
                toolsUsed.push(tc.function.name);

                this.logger.info(`Executing tool: ${tc.function.name}`, {
                    agent: this.name,
                    toolCallId: tc.id,
                    arguments: args
                });

                try {
                    const result = await this.executeTool(tc.function.name, args);
                    return {
                        tool_call_id: tc.id,
                        output: typeof result === 'string' ? result : JSON.stringify(result)
                    };
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Tool execution failed: ${tc.function.name}`, { error: errorMessage });
                    return {
                        tool_call_id: tc.id,
                        output: JSON.stringify({ error: errorMessage })
                    };
                }
            })
        );

        // Step 5: Tool execution completed, return response
        this.logger.info(`Tool execution completed. Tools used: ${toolsUsed.join(', ')}`);

        return {
            text: `Successfully executed ${toolsUsed.length} tool(s): ${toolsUsed.join(', ')}`,
            response,
            toolsUsed
        };
    }

    private extractTextFromResponse(response: Response): string {
        if (response.output_text && response.output_text.trim().length > 0) {
            return response.output_text;
        }

        const texts: string[] = [];
        for (const item of response.output ?? []) {
            if (item.type === 'message') {
                for (const content of item.content) {
                    if (content.type === 'output_text') {
                        texts.push(content.text);
                    }
                }
            }
        }

        return texts.join('\n').trim();
    }

    private safeParseJson<T = Record<string, any>>(value: string | null | undefined): T {
        if (!value) {
            return {} as T;
        }

        try {
            return JSON.parse(value) as T;
        } catch (error) {
            this.logger.warn('Failed to parse JSON payload', { value, error: error instanceof Error ? error.message : String(error) });
            return {} as T;
        }
    }


    /**
     * Perform a task with the current shared memory and chat history
     */
    async performTask(
        taskDescription: string,
        sharedMemory: SharedMemory = {},
        chatHistory: ConversationMessage[] = []
    ): Promise<string> {
        const task = this.createTask(taskDescription);
        this.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

        this.logger.info(`Starting task performance: ${taskDescription.substring(0, 50)}...`);
        this.emit(AgentEvent.TASK_STARTED, {
            agent: this.name,
            task: taskDescription,
            taskId: task.id,
            timestamp: Date.now()
        });

        const conversation: ResponseInputItem[] = [];
        conversation.push(this.buildMessage('system', this.systemPrompt));

        if (this.tools.size > 0) {
            conversation.push(this.buildMessage('system', this.buildToolInstruction()));
        }

        if (Object.keys(sharedMemory).length > 0) {
            conversation.push(this.buildMessage(
                'system',
                `Shared knowledge: ${JSON.stringify(Object.values(sharedMemory).map(item => ({
                    task: item.key,
                    agent: item.agent,
                    result: item.value
                })))}
                `
            ));
        }

        for (const message of chatHistory) {
            conversation.push(this.toResponseInputItem(message));
        }

        conversation.push(this.buildMessage('user', taskDescription));

        this.logger.info(`Built conversation with ${conversation.length} items, starting workflow...`);

        try {
            const { text: result, response, toolsUsed } = await this.runResponseWorkflow(conversation, taskDescription);

            this.updateTaskStatus(task.id, TaskStatus.COMPLETED, result);

            const taskResult: TaskResult = {
                agent: this.name,
                task: taskDescription,
                result,
                timestamp: Date.now(),
                metadata: {
                    taskId: task.id,
                    model: this.llmConfig.model,
                    responseId: response.id,
                    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined
                }
            };

            this.emit(AgentEvent.TASK_COMPLETED, taskResult);
            return result;
        } catch (error) {
            this.logger.error(`Error performing task: ${error}`);
            this.updateTaskStatus(task.id, TaskStatus.FAILED, undefined, error instanceof Error ? error : new Error(String(error)));

            const taskError: TaskError = {
                agent: this.name,
                task: taskDescription,
                error: error instanceof Error ? error : new Error(String(error)),
                timestamp: Date.now(),
                metadata: {
                    taskId: task.id,
                    model: this.llmConfig.model
                }
            };

            this.emit(AgentEvent.TASK_FAILED, taskError);
            throw error;
        }
    }

    /**
     * Perform a reflection on a completed task to improve future performance
     */
    async reflect(taskId: string): Promise<string> {
        const task = this.taskHistory.get(taskId);
        if (!task) {
            throw new Error(`Task with ID ${taskId} not found`);
        }

        if (task.status !== TaskStatus.COMPLETED) {
            throw new Error(`Cannot reflect on task ${taskId} as it is not completed`);
        }

        const reflectionPrompt = dedent`
        As ${this.name}, reflect on how you performed the following task:
        
        Task: ${task.description}
        Result: ${task.result}
        
        Analyze what went well, what could be improved, and what you learned.
        How would you approach a similar task in the future?
        `;

        try {
            const reflection = await withRetry(
                () => this.client.responses.create({
                    model: this.llmConfig.model,
                    input: [
                        this.buildMessage('system', this.systemPrompt),
                        this.buildMessage('user', reflectionPrompt)
                    ],
                    temperature: 0.7
                }),
                this.logger,
                `reflection (${this.name})`
            );

            const reflectionContent = this.extractTextFromResponse(reflection) || 'No reflection generated';

            // Store reflection in task metadata
            if (!task.metadata) task.metadata = {};
            task.metadata.reflection = reflectionContent;
            task.updatedAt = Date.now();
            this.taskHistory.set(taskId, task);

            return reflectionContent;
        } catch (error) {
            this.logger.error(`Error during reflection: ${error}`);
            throw error;
        }
    }
}

export default Agent;
