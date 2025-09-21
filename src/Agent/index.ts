import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import type {
    ChatCompletionMessageFunctionToolCall,
    ChatCompletionMessageToolCall
} from 'openai/resources/chat/completions';
import {
    type AgentConfig,
    AgentEvent,
    type LlmConfig, type SharedMemory,
    type Task,
    type TaskError,
    type TaskResult, TaskStatus,
    type Tool
} from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';
import dedent from 'dedent';

type ChatToolCall = ChatCompletionMessageToolCall;
type FunctionToolCall = ChatCompletionMessageFunctionToolCall;

const isFunctionToolCall = (toolCall: ChatToolCall): toolCall is FunctionToolCall => {
    return toolCall.type === 'function' && 'function' in toolCall;
};

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

    /**
     * Perform a task with the current shared memory and chat history
     */
    async performTask(
        taskDescription: string,
        sharedMemory: SharedMemory = {},
        chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
    ): Promise<string> {
        // Create and track the task
        const task = this.createTask(taskDescription);
        this.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

        this.logger.trace(`Performing task: ${taskDescription}`);
        this.emit(AgentEvent.TASK_STARTED, {
            agent: this.name,
            task: taskDescription,
            taskId: task.id,
            timestamp: Date.now()
        });

        // Prepare the messages
        const messages: OpenAI.ChatCompletionMessageParam[] = [
            { role: 'system', content: this.systemPrompt },
            {
                role: 'system',
                content: `Shared knowledge: ${JSON.stringify(Object.values(sharedMemory).map(item => ({
                    task: item.key,
                    agent: item.agent,
                    result: item.value
                })))}`
            },
            ...chatHistory,
            { role: 'user', content: taskDescription }
        ];

        try {
            // Make the LLM request
            const completion = await this.client.chat.completions.create({
                model: this.llmConfig.model,
                messages,
                temperature: this.llmConfig.temperature,
                max_tokens: this.llmConfig.maxTokens,
                ...(this.tools.size > 0 ? {
                    tool_choice: 'auto',
                    tools: Array.from(this.tools.values()).map(tool => ({
                        type: 'function',
                        function: tool.schema
                    }))
                } : {})
            });

            const responseMessage = completion.choices[0].message;

            // Handle text response
            if (responseMessage.content) {
                const result = responseMessage.content;
                this.updateTaskStatus(task.id, TaskStatus.COMPLETED, result);

                const taskResult: TaskResult = {
                    agent: this.name,
                    task: taskDescription,
                    result,
                    timestamp: Date.now(),
                    metadata: {
                        taskId: task.id,
                        model: this.llmConfig.model
                    }
                };

                this.emit(AgentEvent.TASK_COMPLETED, taskResult);
                return result;
            }
            // Handle tool calls
            else if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                this.logger.info('Tool calls requested by LLM');
                let finalResult = '';
                const expandedMessages = [...messages];

                // Execute each tool call
                for (const toolCall of responseMessage.tool_calls) {
                    if (!isFunctionToolCall(toolCall)) {
                        this.logger.warn('Skipping unsupported tool call type', { type: toolCall.type });
                        continue;
                    }

                    const functionToolCall = toolCall as FunctionToolCall;
                    const { id } = functionToolCall;
                    const { name, arguments: argsString } = functionToolCall.function;

                    try {
                        // Parse tool arguments
                        const args = JSON.parse(argsString ?? '{}');

                        // Execute the tool
                        const result = await this.executeTool(name, args);
                        finalResult += `Tool ${name} result: ${JSON.stringify(result)}\n`;

                        // Add tool result to conversation
                        expandedMessages.push({
                            role: 'assistant',
                            content: null,
                            tool_calls: [functionToolCall]
                        });

                        expandedMessages.push({
                            role: 'tool',
                            tool_call_id: id,
                            content: JSON.stringify(result)
                        });
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        this.logger.error(`Error executing tool ${name}:`, error);
                        finalResult += `Error executing tool ${name}: ${errorMessage}\n`;

                        // Add error to conversation
                        expandedMessages.push({
                            role: 'assistant',
                            content: null,
                            tool_calls: [functionToolCall]
                        });

                        expandedMessages.push({
                            role: 'tool',
                            tool_call_id: id,
                            content: JSON.stringify({ error: errorMessage })
                        });
                    }
                }

                // Get final summary from LLM after tool execution
                expandedMessages.push({
                    role: 'user',
                    content: `Based on the tool results, please provide a final response for the task: ${taskDescription}`
                });

                const summaryCompletion = await this.client.chat.completions.create({
                    model: this.llmConfig.model,
                    messages: expandedMessages,
                    temperature: 0.3, // Lower temperature for more focused summary
                    max_tokens: this.llmConfig.maxTokens
                });

                const summaryResponse = summaryCompletion.choices[0].message.content;
                if (summaryResponse) {
                    finalResult += `Final response: ${summaryResponse}`;
                }

                this.updateTaskStatus(task.id, TaskStatus.COMPLETED, finalResult);

                const taskResult: TaskResult = {
                    agent: this.name,
                    task: taskDescription,
                    result: finalResult,
                    timestamp: Date.now(),
                    metadata: {
                        taskId: task.id,
                        model: this.llmConfig.model,
                        toolsUsed: responseMessage.tool_calls
                            .filter(isFunctionToolCall)
                            .map(tc => tc.function.name)
                    }
                };

                this.emit(AgentEvent.TASK_COMPLETED, taskResult);
                return finalResult;
            } else {
                const errorMessage = 'Unexpected response from LLM: no content or tool calls';
                this.logger.error(errorMessage);
                throw new Error(errorMessage);
            }
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
            const reflection = await this.client.chat.completions.create({
                model: this.llmConfig.model,
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: reflectionPrompt }
                ],
                temperature: 0.7
            });

            const reflectionContent = reflection.choices[0].message.content || 'No reflection generated';

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
