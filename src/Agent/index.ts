import EventEmitter from 'events';
import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
    type AgentConfig,
    AgentEvent,
    type AgentMessage,
    type ConversationMessage,
    type LlmConfig,
    type MessageHandler,
    type MessageHandlerContext,
    type ModelPurpose,
    type StreamChunk,
    type Task,
    type TaskError,
    type TaskResult,
    TaskStatus,
    type Tool
} from '@/utils/types.ts';
import { MessageBus, type SendMessageOptions } from './MessageBus';
import Logger from '@/utils/logger.ts';
import dedent from 'dedent';
import type {
    Response,
    ResponseInputItem,
    ResponseOutputMessage
} from 'openai/resources/responses/responses';
import { withRetry } from '@/utils/retry.ts';
import { ModelRouter } from '@/ModelRouter';

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
    private modelRouter?: ModelRouter;
    private readonly preferredModel?: string;
    private readonly responseSchema?: { schema: any; name: string };

    /** Conversation history for multi-turn chats */
    private conversationHistory: ConversationMessage[] = [];
    /** Maximum messages to keep in history */
    private readonly maxHistoryMessages: number;
    /** Whether to auto-manage history */
    private readonly autoManageHistory: boolean;
    /** Message bus for agent-to-agent communication */
    private messageBus: MessageBus | null = null;
    /** Message handlers registered by this agent */
    private readonly messageHandlers: MessageHandler[] = [];

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
        this.preferredModel = config.preferredModel;
        this.responseSchema = config.responseSchema;
        this.llmConfig = {
            model: config.model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
            temperature: config.temperature || 0.7,
            maxTokens: config.maxTokens || 1024
        };
        this.client = client;
        this.tools = new Map(tools.map(tool => [tool.name, tool]));
        this.taskHistory = new Map();
        this.logger = new Logger(`Agent-${this.name}`);

        // Initialize conversation history management
        this.maxHistoryMessages = config.maxHistoryMessages ?? 50;
        this.autoManageHistory = config.autoManageHistory ?? true;
        this.conversationHistory = [];

        // Register default event handlers
        this.on(AgentEvent.TASK_COMPLETED, this.handleTaskComplete.bind(this));
        this.on(AgentEvent.TASK_FAILED, this.handleTaskError.bind(this));
    }

    /**
     * Set the model router for purpose-based model selection
     * Typically called by Crew when adding the agent
     */
    setModelRouter(router: ModelRouter): void {
        this.modelRouter = router;
    }

    /**
     * Get the model for a specific purpose
     * Priority: preferredModel (for task_execution) > router > llmConfig.model
     */
    private getModelForPurpose(purpose: ModelPurpose): string {
        // For task execution and tool synthesis, prefer the agent's preferred model if set
        if (this.preferredModel && (purpose === 'task_execution' || purpose === 'tool_synthesis')) {
            return this.preferredModel;
        }

        // Use router if available
        if (this.modelRouter) {
            return this.modelRouter.getModel(purpose);
        }

        // Fall back to llmConfig
        return this.llmConfig.model;
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

    // ==========================================
    // Conversation History Management
    // ==========================================

    /**
     * Get the current conversation history
     */
    getHistory(): ConversationMessage[] {
        return [...this.conversationHistory];
    }

    /**
     * Get the number of messages in history
     */
    getHistoryLength(): number {
        return this.conversationHistory.length;
    }

    /**
     * Clear the conversation history
     */
    clearHistory(): void {
        const previousLength = this.conversationHistory.length;
        this.conversationHistory = [];
        this.emit(AgentEvent.HISTORY_CLEARED, {
            agent: this.name,
            previousLength,
            timestamp: Date.now()
        });
        this.logger.info(`Conversation history cleared (was ${previousLength} messages)`);
    }

    /**
     * Add a message to history
     */
    addToHistory(message: ConversationMessage): void {
        this.conversationHistory.push(message);
        this.emit(AgentEvent.MESSAGE_ADDED, {
            agent: this.name,
            role: message.role,
            timestamp: Date.now()
        });

        // Trim if needed
        if (this.conversationHistory.length > this.maxHistoryMessages) {
            this.trimHistory();
        }
    }

    /**
     * Trim history to maxHistoryMessages
     * Removes oldest messages first, but preserves the first system message if present
     */
    private trimHistory(): void {
        const toRemove = this.conversationHistory.length - this.maxHistoryMessages;
        if (toRemove <= 0) return;

        // Keep first message if it's a system message
        const hasSystemFirst = this.conversationHistory[0]?.role === 'system';
        const startIndex = hasSystemFirst ? 1 : 0;

        // Remove oldest messages after the potential system message
        this.conversationHistory.splice(startIndex, toRemove);

        this.emit(AgentEvent.HISTORY_TRIMMED, {
            agent: this.name,
            removedCount: toRemove,
            currentLength: this.conversationHistory.length,
            timestamp: Date.now()
        });
        this.logger.debug(`Trimmed ${toRemove} messages from history`);
    }

    /**
     * Chat with the agent using auto-managed conversation history.
     * This is the recommended method for multi-turn conversations.
     *
     * @param message - The user message
     * @param context - Optional additional context to include
     * @returns The agent's response
     */
    async chat(message: string, context: string = ''): Promise<string> {
        // Add user message to history
        this.addToHistory({ role: 'user', content: message });

        // Perform task with full history
        const response = await this.performTask(
            message,
            context,
            this.autoManageHistory ? this.conversationHistory.slice(0, -1) : [] // Exclude the message we just added (it's in taskDescription)
        );

        // Add assistant response to history
        this.addToHistory({ role: 'assistant', content: response });

        return response;
    }

    /**
     * Set the conversation history (useful for restoring state)
     */
    setHistory(history: ConversationMessage[]): void {
        this.conversationHistory = [...history];
        this.logger.info(`Conversation history set to ${history.length} messages`);
    }

    /**
     * Chat with streaming response. Yields chunks as they arrive from the LLM.
     * Automatically manages conversation history.
     *
     * @param message - The user message
     * @param context - Optional additional context to include
     * @param onChunk - Optional callback for each chunk (alternative to iteration)
     * @yields StreamChunk objects containing text fragments and completion status
     * @returns The complete response text after iteration completes
     *
     * @example
     * ```typescript
     * // Using async iteration
     * let fullResponse = '';
     * for await (const chunk of agent.chatStream('Hello')) {
     *     if (chunk.content) {
     *         process.stdout.write(chunk.content);
     *         fullResponse += chunk.content;
     *     }
     * }
     *
     * // Using callback
     * const response = await agent.chatStream('Hello', '', (chunk) => {
     *     process.stdout.write(chunk.content || '');
     * });
     * ```
     */
    async *chatStream(
        message: string,
        context: string = '',
        onChunk?: (chunk: StreamChunk) => void
    ): AsyncGenerator<StreamChunk, string, unknown> {
        // Add user message to history
        this.addToHistory({ role: 'user', content: message });

        let fullResponse = '';

        // Stream the task with history
        for await (const chunk of this.performTaskStream(
            message,
            context,
            this.autoManageHistory ? this.conversationHistory.slice(0, -1) : []
        )) {
            if (chunk.content) {
                fullResponse += chunk.content;
            }

            // Call the optional callback
            if (onChunk) {
                onChunk(chunk);
            }

            yield chunk;
        }

        // Add assistant response to history
        this.addToHistory({ role: 'assistant', content: fullResponse });

        return fullResponse;
    }

    /**
     * Perform a task with streaming response.
     * Yields chunks as they arrive from the LLM.
     *
     * @param taskDescription - The task to perform
     * @param memoryContext - Pre-built context string from MemoryStore.buildContext()
     * @param chatHistory - Previous conversation messages
     * @yields StreamChunk objects containing text fragments, tool info, and completion status
     */
    async *performTaskStream(
        taskDescription: string,
        memoryContext: string = '',
        chatHistory: ConversationMessage[] = []
    ): AsyncGenerator<StreamChunk, string, unknown> {
        const task = this.createTask(taskDescription);
        this.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

        this.logger.info(`Starting streaming task: ${taskDescription.substring(0, 50)}...`);
        this.emit(AgentEvent.TASK_STARTED, {
            agent: this.name,
            task: taskDescription,
            taskId: task.id,
            timestamp: Date.now(),
            streaming: true
        });

        const conversation: ResponseInputItem[] = [];
        conversation.push(this.buildMessage('system', this.systemPrompt));

        if (this.tools.size > 0) {
            conversation.push(this.buildMessage('system', this.buildToolInstruction()));
        }

        if (memoryContext.length > 0) {
            conversation.push(this.buildMessage('system', memoryContext));
        }

        for (const message of chatHistory) {
            conversation.push(this.toResponseInputItem(message));
        }

        conversation.push(this.buildMessage('user', taskDescription));

        let fullText = '';
        const toolsUsed: string[] = [];

        try {
            // Stream the response
            const { text, toolCalls } = yield* this.streamResponse(conversation);
            fullText = text;

            // If we have tool calls, execute them and get a follow-up response
            if (toolCalls.length > 0) {
                this.logger.info(`Processing ${toolCalls.length} tool calls from stream`);

                // Yield tool call notifications
                for (const tc of toolCalls) {
                    yield {
                        type: 'tool_call_start',
                        toolName: tc.name,
                        toolCallId: tc.call_id,
                        isComplete: false
                    };

                    toolsUsed.push(tc.name);
                    const parseResult = this.parseToolArguments(tc.arguments);

                    let output: string;
                    if (!parseResult.success) {
                        output = JSON.stringify({
                            error: 'Invalid JSON arguments',
                            details: parseResult.error
                        });
                    } else {
                        try {
                            const result = await this.executeTool(tc.name, parseResult.args);
                            output = typeof result === 'string' ? result : JSON.stringify(result);
                        } catch (error) {
                            output = JSON.stringify({
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }
                    }

                    yield {
                        type: 'tool_call_end',
                        toolName: tc.name,
                        toolCallId: tc.call_id,
                        content: output,
                        isComplete: false
                    };

                    // Store tool output for follow-up
                    conversation.push({
                        type: 'function_call_output',
                        call_id: tc.call_id,
                        output
                    } as ResponseInputItem);
                }

                // Get synthesis response (non-streaming for tool follow-up to avoid complexity)
                const synthesisResponse = await this.createResponse(conversation, false);
                const synthesisText = this.extractTextFromResponse(synthesisResponse);

                // Yield the synthesis as a final chunk
                if (synthesisText) {
                    fullText = synthesisText;
                    yield {
                        type: 'text',
                        content: synthesisText,
                        isComplete: false
                    };
                }
            }

            // Final completion signal
            yield {
                type: 'done',
                isComplete: true
            };

            this.emit(AgentEvent.STREAM_END, {
                agent: this.name,
                task: taskDescription,
                taskId: task.id,
                fullText,
                toolsUsed,
                timestamp: Date.now()
            });

            this.updateTaskStatus(task.id, TaskStatus.COMPLETED, fullText);

            const taskResult: TaskResult = {
                agent: this.name,
                task: taskDescription,
                result: fullText,
                timestamp: Date.now(),
                metadata: {
                    taskId: task.id,
                    model: this.llmConfig.model,
                    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
                    streaming: true
                }
            };

            this.emit(AgentEvent.TASK_COMPLETED, taskResult);
            return fullText;
        } catch (error) {
            this.logger.error(`Error in streaming task: ${error}`);
            this.updateTaskStatus(
                task.id,
                TaskStatus.FAILED,
                undefined,
                error instanceof Error ? error : new Error(String(error))
            );

            const taskError: TaskError = {
                agent: this.name,
                task: taskDescription,
                error: error instanceof Error ? error : new Error(String(error)),
                timestamp: Date.now(),
                metadata: { taskId: task.id }
            };

            this.emit(AgentEvent.TASK_FAILED, taskError);
            throw error;
        }
    }

    /**
     * Internal method to stream a response and collect tool calls
     */
    private async *streamResponse(
        conversation: ResponseInputItem[]
    ): AsyncGenerator<StreamChunk, { text: string; toolCalls: Array<{ call_id: string; name: string; arguments: string }> }, unknown> {
        const request: Record<string, any> = {
            model: this.getModelForPurpose('task_execution'),
            input: conversation,
            temperature: this.llmConfig.temperature,
            stream: true
        };

        if (this.llmConfig.maxTokens) {
            request.max_output_tokens = this.llmConfig.maxTokens;
        }

        if (this.tools.size > 0) {
            request.tools = this.buildResponsesToolDefinitions();
            request.tool_choice = 'auto';
        }

        this.logger.debug('Starting streaming request');

        const stream = await this.client.responses.create(request);

        let fullText = '';
        const toolCalls: Array<{ call_id: string; name: string; arguments: string }> = [];
        const pendingToolCalls: Map<string, { name: string; arguments: string }> = new Map();

        // Handle the stream
        for await (const event of stream as AsyncIterable<any>) {
            // Handle different event types from the streaming API
            if (event.type === 'response.output_text.delta') {
                const delta = event.delta || '';
                fullText += delta;

                const chunk: StreamChunk = {
                    type: 'text',
                    content: delta,
                    isComplete: false
                };

                this.emit(AgentEvent.STREAM_CHUNK, {
                    agent: this.name,
                    chunk,
                    timestamp: Date.now()
                });

                yield chunk;
            } else if (event.type === 'response.function_call_arguments.delta') {
                // Accumulate function arguments
                const callId = event.call_id || event.item_id;
                if (callId) {
                    const existing = pendingToolCalls.get(callId) || { name: '', arguments: '' };
                    existing.arguments += event.delta || '';
                    pendingToolCalls.set(callId, existing);
                }
            } else if (event.type === 'response.output_item.added') {
                // New output item (could be a function call)
                if (event.item?.type === 'function_call') {
                    const callId = event.item.call_id || event.item.id;
                    pendingToolCalls.set(callId, {
                        name: event.item.name || '',
                        arguments: ''
                    });
                }
            } else if (event.type === 'response.output_item.done') {
                // Output item completed
                if (event.item?.type === 'function_call') {
                    const callId = event.item.call_id || event.item.id;
                    const pending = pendingToolCalls.get(callId);
                    toolCalls.push({
                        call_id: callId,
                        name: event.item.name || pending?.name || '',
                        arguments: event.item.arguments || pending?.arguments || ''
                    });
                    pendingToolCalls.delete(callId);
                }
            } else if (event.type === 'response.completed' || event.type === 'response.done') {
                // Stream completed - extract any remaining tool calls from the final response
                if (event.response?.output) {
                    for (const item of event.response.output) {
                        if (item.type === 'function_call' && !toolCalls.find(tc => tc.call_id === item.call_id)) {
                            toolCalls.push({
                                call_id: item.call_id,
                                name: item.name,
                                arguments: item.arguments
                            });
                        }
                    }
                }
            }
        }

        return { text: fullText, toolCalls };
    }

    /**
     * Export conversation state for persistence
     */
    exportConversationState(): {
        history: ConversationMessage[];
        agentId: string;
        agentName: string;
        timestamp: number;
    } {
        return {
            history: this.getHistory(),
            agentId: this.id,
            agentName: this.name,
            timestamp: Date.now()
        };
    }

    // ==========================================
    // Agent-to-Agent Messaging
    // ==========================================

    /**
     * Connect this agent to a message bus for agent-to-agent communication.
     * Once connected, the agent can send and receive messages from other agents.
     *
     * @param bus - The message bus to connect to
     *
     * @example
     * ```typescript
     * const bus = new MessageBus();
     * agentA.connectToMessageBus(bus);
     * agentB.connectToMessageBus(bus);
     *
     * agentA.sendMessage('AgentB', 'Hello!');
     * ```
     */
    connectToMessageBus(bus: MessageBus): void {
        if (this.messageBus) {
            this.disconnectFromMessageBus();
        }

        this.messageBus = bus;

        // Register with the bus using our combined handler
        bus.registerAgent(this.name, async (ctx) => {
            this.emit(AgentEvent.MESSAGE_RECEIVED, {
                agent: this.name,
                from: ctx.message.from,
                message: ctx.message,
                timestamp: Date.now()
            });

            // Call all registered handlers
            for (const handler of this.messageHandlers) {
                await handler(ctx);
            }
        });

        this.logger.info(`Connected to message bus`);
    }

    /**
     * Disconnect this agent from the message bus
     */
    disconnectFromMessageBus(): void {
        if (this.messageBus) {
            this.messageBus.unregisterAgent(this.name);
            this.messageBus = null;
            this.logger.info(`Disconnected from message bus`);
        }
    }

    /**
     * Check if this agent is connected to a message bus
     */
    isConnectedToMessageBus(): boolean {
        return this.messageBus !== null;
    }

    /**
     * Send a message to another agent.
     * The agent must be connected to a message bus.
     *
     * @param to - The name of the recipient agent (or array of names for multi-cast)
     * @param content - The message content
     * @param options - Optional message options (type, metadata, priority)
     * @returns The sent message object
     *
     * @example
     * ```typescript
     * // Simple notification
     * agent.sendMessage('OtherAgent', 'Task completed');
     *
     * // Request with metadata
     * agent.sendMessage('OtherAgent', 'Process this data', {
     *     type: 'request',
     *     metadata: { data: someData },
     *     priority: 'high'
     * });
     *
     * // Multi-cast to multiple agents
     * agent.sendMessage(['Agent1', 'Agent2'], 'Broadcast message');
     * ```
     */
    sendMessage(
        to: string | string[],
        content: string,
        options: SendMessageOptions = {}
    ): AgentMessage {
        if (!this.messageBus) {
            throw new Error('Agent is not connected to a message bus');
        }

        const message = this.messageBus.send(this.name, to, content, options);

        this.emit(AgentEvent.MESSAGE_SENT, {
            agent: this.name,
            to,
            message,
            timestamp: Date.now()
        });

        return message;
    }

    /**
     * Send a message and wait for a reply.
     * Useful for request-response patterns between agents.
     *
     * @param to - The name of the recipient agent
     * @param content - The message content
     * @param options - Optional message options
     * @param timeoutMs - Timeout in milliseconds (default: 30000)
     * @returns Promise resolving to the reply message
     *
     * @example
     * ```typescript
     * const reply = await agent.sendMessageAndWait('OtherAgent', 'What is the status?');
     * console.log('Reply:', reply.content);
     * ```
     */
    async sendMessageAndWait(
        to: string,
        content: string,
        options: SendMessageOptions = {},
        timeoutMs: number = 30000
    ): Promise<AgentMessage> {
        if (!this.messageBus) {
            throw new Error('Agent is not connected to a message bus');
        }

        return this.messageBus.sendAndWait(this.name, to, content, options, timeoutMs);
    }

    /**
     * Broadcast a message to all agents on the message bus.
     *
     * @param content - The message content
     * @param options - Optional message options
     * @returns The sent message object
     */
    broadcastMessage(content: string, options: Omit<SendMessageOptions, 'type'> = {}): AgentMessage {
        if (!this.messageBus) {
            throw new Error('Agent is not connected to a message bus');
        }

        return this.messageBus.broadcast(this.name, content, options);
    }

    /**
     * Register a handler for incoming messages.
     * Multiple handlers can be registered and will be called in order.
     *
     * @param handler - Function to handle incoming messages
     * @returns A function to unregister the handler
     *
     * @example
     * ```typescript
     * const unsubscribe = agent.onMessage((ctx) => {
     *     console.log(`Received from ${ctx.message.from}: ${ctx.message.content}`);
     *
     *     // Reply if it's a request
     *     if (ctx.message.type === 'request') {
     *         ctx.reply('Here is my response');
     *     }
     * });
     *
     * // Later, to stop receiving messages:
     * unsubscribe();
     * ```
     */
    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.push(handler);

        // Return unsubscribe function
        return () => {
            const index = this.messageHandlers.indexOf(handler);
            if (index !== -1) {
                this.messageHandlers.splice(index, 1);
            }
        };
    }

    /**
     * Get the number of registered message handlers
     */
    getMessageHandlerCount(): number {
        return this.messageHandlers.length;
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
            model: this.getModelForPurpose('task_execution'),
            input: conversation,
            temperature: this.llmConfig.temperature
        };

        if (this.llmConfig.maxTokens) {
            request.max_output_tokens = this.llmConfig.maxTokens;
        }

        // Add structured output format if responseSchema is provided
        if (this.responseSchema) {
            request.text = {
                format: zodTextFormat(this.responseSchema.schema, this.responseSchema.name)
            };
            this.logger.info(`Using structured output schema: ${this.responseSchema.name}`);
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

    private async runResponseWorkflow(conversation: ResponseInputItem[], _taskDescription: string = ''): Promise<{ text: string; response: Response; toolsUsed: string[] }> {
        const toolsUsed: string[] = [];

        this.logger.info(`Starting response workflow with ${this.tools.size} tools available`);

        // Step 1: Get initial response with potential tool calls
        let response = await this.createResponse(conversation, this.tools.size > 0);

        this.logger.info(`Got initial response, checking for tool calls...`);

        // Step 2: Extract tool calls from the response (handle both function_call items and message-embedded tool calls)
        this.logger.debug(`Full response output:`, JSON.stringify(response.output, null, 2));

        const toolCalls = this.extractToolCalls(response);

        this.logger.info(`Extracted ${toolCalls.length} tool calls from response`);

        // Step 3: If no tools called, return the response immediately
        if (toolCalls.length === 0) {
            const text = this.extractTextFromResponse(response);
            if (this.tools.size > 0 && !text) {
                this.logger.warn(`No tool calls found and no text response. Available tools: ${Array.from(this.tools.keys()).join(', ')}`);
            }
            return {
                text,
                response,
                toolsUsed
            };
        }

        this.logger.info(`Found ${toolCalls.length} tool calls to execute`);

        // Step 4: Execute all tool calls and prepare outputs for the model
        const toolOutputs: ResponseInputItem[] = [];

        for (const tc of toolCalls) {
            const parseResult = this.parseToolArguments(tc.arguments);
            toolsUsed.push(tc.name);

            this.logger.info(`Executing tool: ${tc.name}`, {
                agent: this.name,
                toolCallId: tc.call_id,
                arguments: parseResult.success ? parseResult.args : '<parse failed>'
            });

            let output: string;

            if (!parseResult.success) {
                // Surface argument parsing failure to the model so it can retry
                output = JSON.stringify({
                    error: 'Invalid JSON arguments',
                    details: parseResult.error,
                    rawArguments: tc.arguments
                });
                this.logger.error(`Failed to parse arguments for tool ${tc.name}:`, { error: parseResult.error });
            } else {
                try {
                    const result = await this.executeTool(tc.name, parseResult.args);
                    output = typeof result === 'string' ? result : JSON.stringify(result);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Tool execution failed: ${tc.name}`, { error: errorMessage });
                    output = JSON.stringify({ error: errorMessage });
                }
            }

            toolOutputs.push({
                type: 'function_call_output',
                call_id: tc.call_id,
                output
            } as ResponseInputItem);
        }

        // Step 5: Send tool outputs back to the model for synthesis
        this.logger.info(`Sending ${toolOutputs.length} tool outputs back to model for synthesis`);

        // Use previous_response_id to maintain structured context.
        // This preserves the full function_call items (name, args, call_id) from the
        // initial response, allowing the model to deterministically align outputs to tools.
        // The input only needs the function_call_output items - the API handles context.
        const finalResponse = await withRetry(
            () => this.client.responses.create({
                model: this.getModelForPurpose('tool_synthesis'),
                previous_response_id: response.id,  // Preserves structured tool-call context
                input: toolOutputs,                  // Only the function_call_output items
                temperature: this.llmConfig.temperature,
                ...(this.llmConfig.maxTokens ? { max_output_tokens: this.llmConfig.maxTokens } : {})
            }),
            this.logger,
            `responses.create follow-up (${this.name})`
        );

        this.logger.info(`Tool execution and synthesis completed. Tools used: ${toolsUsed.join(', ')}`);

        return {
            text: this.extractTextFromResponse(finalResponse),
            response: finalResponse,
            toolsUsed
        };
    }

    /**
     * Extract tool calls from response output.
     * Handles the primary Responses API format (function_call items).
     */
    private extractToolCalls(response: Response): Array<{ call_id: string; name: string; arguments: string }> {
        const toolCalls: Array<{ call_id: string; name: string; arguments: string }> = [];

        for (const item of response.output ?? []) {
            // Handle function_call items (Responses API format)
            if (item.type === 'function_call') {
                const fc = item as any;
                toolCalls.push({
                    call_id: fc.call_id,
                    name: fc.name,
                    arguments: fc.arguments
                });
            }
            // Note: The Responses API primarily uses function_call items at the output level.
            // Message-embedded tool_use is an Anthropic/Claude format, not OpenAI Responses API.
            // Keeping minimal handling for potential future compatibility.
            else if (item.type === 'message' && 'content' in item) {
                for (const content of (item as any).content ?? []) {
                    if (content.type === 'tool_use' || content.type === 'function_call') {
                        toolCalls.push({
                            call_id: content.id || content.call_id,
                            name: content.name,
                            arguments: typeof content.input === 'string'
                                ? content.input
                                : JSON.stringify(content.input || content.arguments || {})
                        });
                    }
                }
            }
        }

        return toolCalls;
    }

    /**
     * Parse tool arguments with explicit success/failure handling
     */
    private parseToolArguments(value: string | null | undefined): { success: true; args: Record<string, any> } | { success: false; error: string; args: Record<string, any> } {
        if (!value || value.trim() === '') {
            return { success: true, args: {} };
        }

        try {
            const parsed = JSON.parse(value);
            return { success: true, args: parsed };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                args: {} // Fallback for backwards compatibility, but caller should check success
            };
        }
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

    /**
     * Perform a task with optional memory context and chat history
     * @param taskDescription - The task to perform
     * @param memoryContext - Pre-built context string from MemoryStore.buildContext()
     * @param chatHistory - Previous conversation messages
     */
    async performTask(
        taskDescription: string,
        memoryContext: string = '',
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

        if (memoryContext.length > 0) {
            conversation.push(this.buildMessage('system', memoryContext));
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
                    model: this.getModelForPurpose('reflection'),
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
