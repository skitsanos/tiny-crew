import { randomUUID } from 'node:crypto';
import EventEmitter from 'node:events';
import type { ModelRouter } from '@tinycrew/ModelRouter';
import Logger from '@tinycrew/utils/logger';
import {
    buildMessage,
    extractTextFromResponse,
    toResponseInputItem,
} from '@tinycrew/utils/responseHelpers';
import { withRetry } from '@tinycrew/utils/retry';
import {
    type AgentConfig,
    AgentEvent,
    type AgentMessage,
    type ConversationMessage,
    type LlmConfig,
    type MessageHandler,
    type ModelPurpose,
    type StreamChunk,
    type Task,
    type TaskError,
    type TaskResult,
    TaskStatus,
    type Tool,
} from '@tinycrew/utils/types';
import dedent from 'dedent';
import type OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type {
    Response,
    ResponseInputItem,
} from 'openai/resources/responses/responses';
import { summarizeConversation } from './conversation';
import type { MessageBus, SendMessageOptions } from './MessageBus';
import { AgentMessaging } from './messaging';
import { accumulateStreamToolCalls, createStreamState } from './streaming';
import {
    buildToolDefinitions,
    buildToolInstruction,
    type ExtractedToolCall,
    extractToolCalls,
    parseToolArguments,
} from './toolCalling';

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
    /** Whether to enable auto-summarization */
    private readonly enableSummarization: boolean;
    /** Token threshold for triggering summarization */
    private readonly summarizationThreshold: number;
    /** Model to use for summarization */
    private readonly summarizationModel?: string;
    /** Stored conversation summary (from previous summarizations) */
    private conversationSummary: string = '';
    /** Agent-to-agent messaging (bus connection + inbound handlers) */
    private readonly messaging: AgentMessaging;

    /**
     * Create a new Agent instance
     */
    constructor(config: AgentConfig, client: OpenAI, tools: Tool[] = []) {
        super();
        this.id = randomUUID();
        this.name = config.name;
        this.goal = config.goal;
        this.expectedOutput = config.expectedOutput;
        this.systemPrompt =
            config.systemPrompt || this.buildDefaultSystemPrompt();
        this.capabilities = config.capabilities || [];
        this.preferredModel = config.preferredModel;
        this.responseSchema = config.responseSchema;
        this.llmConfig = {
            model: config.model || process.env.DEFAULT_MODEL || 'gpt-4o-mini',
            temperature: config.temperature, // undefined if not set - let model use its default
            maxTokens: config.maxTokens, // undefined if not set - let model use its default
            reasoningEffort: config.reasoningEffort, // undefined = model default
        };
        this.client = client;
        this.tools = new Map(tools.map((tool) => [tool.name, tool]));
        this.taskHistory = new Map();
        this.logger = new Logger(`Agent-${this.name}`);
        this.messaging = new AgentMessaging(this.name, this.logger, (e, p) =>
            this.emit(e, p),
        );

        // Initialize conversation history management
        this.maxHistoryMessages = config.maxHistoryMessages ?? 50;
        this.autoManageHistory = config.autoManageHistory ?? true;
        this.conversationHistory = [];

        // Initialize summarization settings
        this.enableSummarization = config.enableSummarization ?? false;
        this.summarizationThreshold = config.summarizationThreshold ?? 3000;
        this.summarizationModel = config.summarizationModel;

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
        if (
            this.preferredModel &&
            (purpose === 'task_execution' || purpose === 'tool_synthesis')
        ) {
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
            timestamp: Date.now(),
        });
        this.logger.info(
            `Conversation history cleared (was ${previousLength} messages)`,
        );
    }

    /**
     * Add a message to history
     */
    async addToHistory(message: ConversationMessage): Promise<void> {
        this.conversationHistory.push(message);
        this.emit(AgentEvent.MESSAGE_ADDED, {
            agent: this.name,
            role: message.role,
            timestamp: Date.now(),
        });

        // Trim if needed (may trigger summarization if enabled)
        if (this.conversationHistory.length > this.maxHistoryMessages) {
            await this.trimHistory();
        }
    }

    /**
     * Trim history to maxHistoryMessages
     * Removes oldest messages first, but preserves the first system message if present.
     * If summarization is enabled, will summarize old messages instead of discarding.
     */
    private async trimHistory(): Promise<void> {
        const toRemove =
            this.conversationHistory.length - this.maxHistoryMessages;
        if (toRemove <= 0) return;

        // Check if we should summarize instead of just trimming
        if (this.enableSummarization) {
            const estimatedTokens = this.estimateHistoryTokens();
            if (estimatedTokens > this.summarizationThreshold) {
                await this.summarizeHistory();
                return;
            }
        }

        // Keep first message if it's a system message
        const hasSystemFirst = this.conversationHistory[0]?.role === 'system';
        const startIndex = hasSystemFirst ? 1 : 0;

        // Remove oldest messages after the potential system message
        this.conversationHistory.splice(startIndex, toRemove);

        this.emit(AgentEvent.HISTORY_TRIMMED, {
            agent: this.name,
            removedCount: toRemove,
            currentLength: this.conversationHistory.length,
            timestamp: Date.now(),
        });
        this.logger.debug(`Trimmed ${toRemove} messages from history`);
    }

    /**
     * Estimate the number of tokens in the conversation history.
     * Uses a rough approximation of ~4 characters per token.
     */
    estimateHistoryTokens(): number {
        let totalChars = 0;
        for (const message of this.conversationHistory) {
            totalChars += message.content.length;
        }
        // Also include existing summary if any
        totalChars += this.conversationSummary.length;
        // Approximate 4 characters per token
        return Math.ceil(totalChars / 4);
    }

    /**
     * Summarize older conversation history to reduce context size while preserving key information.
     * This method compresses old messages into a summary and keeps only recent messages.
     *
     * @param keepRecentCount - Number of recent messages to keep without summarizing (default: 10)
     * @returns The generated summary
     *
     * @example
     * ```typescript
     * // Manually trigger summarization
     * const summary = await agent.summarizeHistory();
     *
     * // Keep more recent messages
     * const summary = await agent.summarizeHistory(20);
     * ```
     */
    async summarizeHistory(keepRecentCount: number = 10): Promise<string> {
        const result = await summarizeConversation({
            history: this.conversationHistory,
            existingSummary: this.conversationSummary,
            keepRecentCount,
            client: this.client,
            model:
                this.summarizationModel ||
                this.getModelForPurpose('summarization'),
            temperature: this.llmConfig.temperature,
            logger: this.logger,
            agentName: this.name,
        });

        this.conversationHistory = result.history;

        if (result.didSummarize) {
            this.conversationSummary = result.summary;
            this.emit(AgentEvent.HISTORY_SUMMARIZED, {
                agent: this.name,
                previousLength: result.previousLength,
                newLength: this.conversationHistory.length,
                summarizedCount: result.summarizedCount,
                summaryLength: result.summary.length,
                timestamp: Date.now(),
            });
        }

        return result.summary;
    }

    /**
     * Get the current conversation summary (if any exists from previous summarizations)
     */
    getConversationSummary(): string {
        return this.conversationSummary;
    }

    /**
     * Set the conversation summary (useful for restoring state)
     */
    setConversationSummary(summary: string): void {
        this.conversationSummary = summary;
    }

    /**
     * Check if summarization is enabled for this agent
     */
    isSummarizationEnabled(): boolean {
        return this.enableSummarization;
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
        await this.addToHistory({ role: 'user', content: message });

        // Perform task with full history
        const response = await this.performTask(
            message,
            context,
            this.autoManageHistory ? this.conversationHistory.slice(0, -1) : [], // Exclude the message we just added (it's in taskDescription)
        );

        // Add assistant response to history
        await this.addToHistory({ role: 'assistant', content: response });

        return response;
    }

    /**
     * Set the conversation history (useful for restoring state)
     */
    setHistory(history: ConversationMessage[]): void {
        this.conversationHistory = [...history];
        this.logger.info(
            `Conversation history set to ${history.length} messages`,
        );
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
        onChunk?: (chunk: StreamChunk) => void,
    ): AsyncGenerator<StreamChunk, string, unknown> {
        // Add user message to history
        await this.addToHistory({ role: 'user', content: message });

        let fullResponse = '';

        // Stream the task with history
        for await (const chunk of this.performTaskStream(
            message,
            context,
            this.autoManageHistory ? this.conversationHistory.slice(0, -1) : [],
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
        await this.addToHistory({ role: 'assistant', content: fullResponse });

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
        chatHistory: ConversationMessage[] = [],
    ): AsyncGenerator<StreamChunk, string, unknown> {
        const task = this.createTask(taskDescription);
        this.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

        this.logger.info(
            `Starting streaming task: ${taskDescription.substring(0, 50)}...`,
        );
        this.emit(AgentEvent.TASK_STARTED, {
            agent: this.name,
            task: taskDescription,
            taskId: task.id,
            timestamp: Date.now(),
            streaming: true,
        });

        const conversation: ResponseInputItem[] = [];
        conversation.push(buildMessage('system', this.systemPrompt));

        if (this.tools.size > 0) {
            conversation.push(
                buildMessage('system', buildToolInstruction(this.tools)),
            );
        }

        if (memoryContext.length > 0) {
            conversation.push(buildMessage('system', memoryContext));
        }

        for (const message of chatHistory) {
            conversation.push(toResponseInputItem(message));
        }

        conversation.push(buildMessage('user', taskDescription));

        let fullText = '';
        const toolsUsed: string[] = [];

        try {
            // Stream the response
            const { text, toolCalls, responseId } =
                yield* this.streamResponse(conversation);
            fullText = text;

            // If we have tool calls, execute them and get a follow-up response
            if (toolCalls.length > 0) {
                this.logger.info(
                    `Processing ${toolCalls.length} tool calls from stream`,
                );

                yield* this.streamToolExecutions(
                    toolCalls,
                    conversation,
                    toolsUsed,
                );

                // Get synthesis response (non-streaming for tool follow-up to avoid complexity)
                // Use previous_response_id to maintain structured tool-call context
                const synthesisResponse = await this.createResponse(
                    conversation,
                    false,
                    responseId,
                );
                const synthesisText =
                    extractTextFromResponse(synthesisResponse);

                // Yield the synthesis as a final chunk
                if (synthesisText) {
                    fullText = synthesisText;
                    yield {
                        type: 'text',
                        content: synthesisText,
                        isComplete: false,
                    };
                }
            }

            // Final completion signal
            yield {
                type: 'done',
                isComplete: true,
            };

            this.emit(AgentEvent.STREAM_END, {
                agent: this.name,
                task: taskDescription,
                taskId: task.id,
                fullText,
                toolsUsed,
                timestamp: Date.now(),
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
                    streaming: true,
                },
            };

            this.emit(AgentEvent.TASK_COMPLETED, taskResult);
            return fullText;
        } catch (error) {
            this.logger.error(`Error in streaming task: ${error}`);
            this.updateTaskStatus(
                task.id,
                TaskStatus.FAILED,
                undefined,
                error instanceof Error ? error : new Error(String(error)),
            );

            const taskError: TaskError = {
                agent: this.name,
                task: taskDescription,
                error:
                    error instanceof Error ? error : new Error(String(error)),
                timestamp: Date.now(),
                metadata: { taskId: task.id },
            };

            this.emit(AgentEvent.TASK_FAILED, taskError);
            throw error;
        }
    }

    /**
     * Internal method to stream a response and collect tool calls
     */
    /**
     * Execute streamed tool calls, yielding start/end chunks and appending the
     * function_call_output items to the conversation for synthesis.
     */
    private async *streamToolExecutions(
        toolCalls: ExtractedToolCall[],
        conversation: ResponseInputItem[],
        toolsUsed: string[],
    ): AsyncGenerator<StreamChunk, void, unknown> {
        for (const tc of toolCalls) {
            yield {
                type: 'tool_call_start',
                toolName: tc.name,
                toolCallId: tc.call_id,
                isComplete: false,
            };

            toolsUsed.push(tc.name);
            const output = await this.runToolToString(tc);

            yield {
                type: 'tool_call_end',
                toolName: tc.name,
                toolCallId: tc.call_id,
                content: output,
                isComplete: false,
            };

            conversation.push({
                type: 'function_call_output',
                call_id: tc.call_id,
                output,
            } as ResponseInputItem);
        }
    }

    /** Run a single tool call and return its output serialized to a string */
    private async runToolToString(tc: ExtractedToolCall): Promise<string> {
        const parseResult = parseToolArguments(tc.arguments);
        if (!parseResult.success) {
            return JSON.stringify({
                error: 'Invalid JSON arguments',
                details: parseResult.error,
            });
        }

        try {
            const result = await this.executeTool(tc.name, parseResult.args);
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** Build the streaming responses.create request payload */
    private buildStreamRequest(
        conversation: ResponseInputItem[],
    ): Record<string, any> {
        const request: Record<string, any> = {
            model: this.getModelForPurpose('task_execution'),
            input: conversation,
            stream: true,
        };

        this.applyGenerationParams(request);

        if (this.tools.size > 0) {
            request.tools = buildToolDefinitions(this.tools);
            request.tool_choice = 'auto';
        }

        return request;
    }

    /** Apply shared generation params (temperature, token limit, reasoning) */
    private applyGenerationParams(request: Record<string, any>): void {
        if (this.llmConfig.temperature !== undefined) {
            request.temperature = this.llmConfig.temperature;
        }
        if (this.llmConfig.maxTokens !== undefined) {
            request.max_output_tokens = this.llmConfig.maxTokens;
        }
        if (this.llmConfig.reasoningEffort) {
            request.reasoning = { effort: this.llmConfig.reasoningEffort };
        }
    }

    private async *streamResponse(
        conversation: ResponseInputItem[],
    ): AsyncGenerator<
        StreamChunk,
        {
            text: string;
            toolCalls: ExtractedToolCall[];
            responseId?: string;
        },
        unknown
    > {
        this.logger.debug('Starting streaming request');
        const stream = await this.client.responses.create(
            this.buildStreamRequest(conversation),
        );

        const state = createStreamState();

        for await (const event of stream as unknown as AsyncIterable<any>) {
            // Only text deltas are yielded; tool-call events are accumulated.
            if (event.type === 'response.output_text.delta') {
                const delta = event.delta || '';
                state.fullText += delta;

                const chunk: StreamChunk = {
                    type: 'text',
                    content: delta,
                    isComplete: false,
                };

                this.emit(AgentEvent.STREAM_CHUNK, {
                    agent: this.name,
                    chunk,
                    timestamp: Date.now(),
                });

                yield chunk;
            } else {
                accumulateStreamToolCalls(event, state);
            }
        }

        return {
            text: state.fullText,
            toolCalls: state.toolCalls,
            responseId: state.responseId,
        };
    }

    /**
     * Export conversation state for persistence
     */
    exportConversationState(): {
        history: ConversationMessage[];
        summary: string;
        agentId: string;
        agentName: string;
        timestamp: number;
    } {
        return {
            history: this.getHistory(),
            summary: this.conversationSummary,
            agentId: this.id,
            agentName: this.name,
            timestamp: Date.now(),
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
        this.messaging.connect(bus);
    }

    /**
     * Disconnect this agent from the message bus
     */
    disconnectFromMessageBus(): void {
        this.messaging.disconnect();
    }

    /**
     * Check if this agent is connected to a message bus
     */
    isConnectedToMessageBus(): boolean {
        return this.messaging.isConnected();
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
        options: SendMessageOptions = {},
    ): AgentMessage {
        return this.messaging.send(to, content, options);
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
        timeoutMs: number = 30000,
    ): Promise<AgentMessage> {
        return this.messaging.sendAndWait(to, content, options, timeoutMs);
    }

    /**
     * Broadcast a message to all agents on the message bus.
     *
     * @param content - The message content
     * @param options - Optional message options
     * @returns The sent message object
     */
    broadcastMessage(
        content: string,
        options: Omit<SendMessageOptions, 'type'> = {},
    ): AgentMessage {
        return this.messaging.broadcast(content, options);
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
        return this.messaging.onMessage(handler);
    }

    /**
     * Get the number of registered message handlers
     */
    getMessageHandlerCount(): number {
        return this.messaging.handlerCount();
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
            updatedAt: now,
        };

        this.taskHistory.set(taskId, task);
        return task;
    }

    /**
     * Update task status
     */
    private updateTaskStatus(
        taskId: string,
        status: TaskStatus,
        result?: string,
        error?: Error,
    ): void {
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
        if (tool.validateInput && !(await tool.validateInput(args))) {
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
                timestamp: Date.now(),
            });
            return result;
        } catch (error) {
            this.logger.error(`Error executing tool ${toolName}:`, error);
            throw error;
        }
    }

    private async createResponse(
        conversation: ResponseInputItem[],
        allowTools: boolean,
        previousResponseId?: string,
    ): Promise<Response> {
        const request: Record<string, any> = {
            model: this.getModelForPurpose('task_execution'),
            input: conversation,
        };

        // Use previous_response_id for tool synthesis to maintain structured context
        if (previousResponseId) {
            request.previous_response_id = previousResponseId;
        }

        this.applyGenerationParams(request);

        // Add structured output format if responseSchema is provided
        if (this.responseSchema) {
            request.text = {
                format: zodTextFormat(
                    this.responseSchema.schema,
                    this.responseSchema.name,
                ),
            };
            this.logger.info(
                `Using structured output schema: ${this.responseSchema.name}`,
            );
        }

        if (allowTools && this.tools.size > 0) {
            const tools = buildToolDefinitions(this.tools);
            this.logger.info(`Adding ${tools.length} tools to request`);
            this.logger.debug(
                `Tools definition:`,
                JSON.stringify(tools, null, 2),
            );
            request.tools = tools;
            request.tool_choice = 'auto';
        }

        this.logger.debug(`Full request:`, JSON.stringify(request, null, 2));
        this.logger.info(`Making responses.create call...`);

        return await withRetry(
            () => this.client.responses.create(request),
            this.logger,
            `responses.create (${this.name})`,
        );
    }

    /** Execute tool calls (non-streaming) into function_call_output items */
    private async executeToolCalls(
        toolCalls: ExtractedToolCall[],
        toolsUsed: string[],
    ): Promise<ResponseInputItem[]> {
        const toolOutputs: ResponseInputItem[] = [];
        for (const tc of toolCalls) {
            toolsUsed.push(tc.name);
            const output = await this.runToolCallLogged(tc);
            toolOutputs.push({
                type: 'function_call_output',
                call_id: tc.call_id,
                output,
            } as ResponseInputItem);
        }
        return toolOutputs;
    }

    /** Run one tool call with logging, returning its serialized output */
    private async runToolCallLogged(tc: ExtractedToolCall): Promise<string> {
        const parseResult = parseToolArguments(tc.arguments);

        this.logger.info(`Executing tool: ${tc.name}`, {
            agent: this.name,
            toolCallId: tc.call_id,
            arguments: parseResult.success
                ? parseResult.args
                : '<parse failed>',
        });

        if (!parseResult.success) {
            // Surface argument parsing failure to the model so it can retry
            this.logger.error(
                `Failed to parse arguments for tool ${tc.name}:`,
                { error: parseResult.error },
            );
            return JSON.stringify({
                error: 'Invalid JSON arguments',
                details: parseResult.error,
                rawArguments: tc.arguments,
            });
        }

        try {
            const result = await this.executeTool(tc.name, parseResult.args);
            return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            this.logger.error(`Tool execution failed: ${tc.name}`, {
                error: errorMessage,
            });
            return JSON.stringify({ error: errorMessage });
        }
    }

    private async runResponseWorkflow(
        conversation: ResponseInputItem[],
        _taskDescription: string = '',
    ): Promise<{ text: string; response: Response; toolsUsed: string[] }> {
        const toolsUsed: string[] = [];

        this.logger.info(
            `Starting response workflow with ${this.tools.size} tools available`,
        );

        // Step 1: Get initial response with potential tool calls
        const response = await this.createResponse(
            conversation,
            this.tools.size > 0,
        );

        this.logger.info(`Got initial response, checking for tool calls...`);

        // Step 2: Extract tool calls from the response (handle both function_call items and message-embedded tool calls)
        this.logger.debug(
            `Full response output:`,
            JSON.stringify(response.output, null, 2),
        );

        const toolCalls = extractToolCalls(response.output ?? []);

        this.logger.info(
            `Extracted ${toolCalls.length} tool calls from response`,
        );

        // Step 3: If no tools called, return the response immediately
        if (toolCalls.length === 0) {
            const text = extractTextFromResponse(response);
            if (this.tools.size > 0 && !text) {
                this.logger.warn(
                    `No tool calls found and no text response. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
                );
            }
            return {
                text,
                response,
                toolsUsed,
            };
        }

        this.logger.info(`Found ${toolCalls.length} tool calls to execute`);

        // Step 4: Execute all tool calls and prepare outputs for the model
        const toolOutputs = await this.executeToolCalls(toolCalls, toolsUsed);

        // Step 5: Send tool outputs back to the model for synthesis
        this.logger.info(
            `Sending ${toolOutputs.length} tool outputs back to model for synthesis`,
        );

        // Use previous_response_id to maintain structured context.
        // This preserves the full function_call items (name, args, call_id) from the
        // initial response, allowing the model to deterministically align outputs to tools.
        // The input only needs the function_call_output items - the API handles context.
        const finalResponse = await withRetry(
            () =>
                this.client.responses.create({
                    model: this.getModelForPurpose('tool_synthesis'),
                    previous_response_id: response.id, // Preserves structured tool-call context
                    input: toolOutputs, // Only the function_call_output items
                    ...(this.llmConfig.temperature !== undefined
                        ? { temperature: this.llmConfig.temperature }
                        : {}),
                    ...(this.llmConfig.maxTokens !== undefined
                        ? { max_output_tokens: this.llmConfig.maxTokens }
                        : {}),
                    ...(this.llmConfig.reasoningEffort
                        ? {
                              reasoning: {
                                  effort: this.llmConfig.reasoningEffort,
                              },
                          }
                        : {}),
                }),
            this.logger,
            `responses.create follow-up (${this.name})`,
        );

        this.logger.info(
            `Tool execution and synthesis completed. Tools used: ${toolsUsed.join(', ')}`,
        );

        return {
            text: extractTextFromResponse(finalResponse),
            response: finalResponse,
            toolsUsed,
        };
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
        chatHistory: ConversationMessage[] = [],
    ): Promise<string> {
        const task = this.createTask(taskDescription);
        this.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

        this.logger.info(
            `Starting task performance: ${taskDescription.substring(0, 50)}...`,
        );
        this.emit(AgentEvent.TASK_STARTED, {
            agent: this.name,
            task: taskDescription,
            taskId: task.id,
            timestamp: Date.now(),
        });

        const conversation: ResponseInputItem[] = [];
        conversation.push(buildMessage('system', this.systemPrompt));

        if (this.tools.size > 0) {
            conversation.push(
                buildMessage('system', buildToolInstruction(this.tools)),
            );
        }

        if (memoryContext.length > 0) {
            conversation.push(buildMessage('system', memoryContext));
        }

        for (const message of chatHistory) {
            conversation.push(toResponseInputItem(message));
        }

        conversation.push(buildMessage('user', taskDescription));

        this.logger.info(
            `Built conversation with ${conversation.length} items, starting workflow...`,
        );

        try {
            const {
                text: result,
                response,
                toolsUsed,
            } = await this.runResponseWorkflow(conversation, taskDescription);

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
                    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
                },
            };

            this.emit(AgentEvent.TASK_COMPLETED, taskResult);
            return result;
        } catch (error) {
            this.logger.error(`Error performing task: ${error}`);
            this.updateTaskStatus(
                task.id,
                TaskStatus.FAILED,
                undefined,
                error instanceof Error ? error : new Error(String(error)),
            );

            const taskError: TaskError = {
                agent: this.name,
                task: taskDescription,
                error:
                    error instanceof Error ? error : new Error(String(error)),
                timestamp: Date.now(),
                metadata: {
                    taskId: task.id,
                    model: this.llmConfig.model,
                },
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
            throw new Error(
                `Cannot reflect on task ${taskId} as it is not completed`,
            );
        }

        const reflectionPrompt = dedent`
        As ${this.name}, reflect on how you performed the following task:
        
        Task: ${task.description}
        Result: ${task.result}
        
        Analyze what went well, what could be improved, and what you learned.
        How would you approach a similar task in the future?
        `;

        try {
            const reflectionRequest: Record<string, any> = {
                model: this.getModelForPurpose('reflection'),
                input: [
                    buildMessage('system', this.systemPrompt),
                    buildMessage('user', reflectionPrompt),
                ],
            };
            this.applyGenerationParams(reflectionRequest);

            const reflection = await withRetry(
                () => this.client.responses.create(reflectionRequest),
                this.logger,
                `reflection (${this.name})`,
            );

            const reflectionContent =
                extractTextFromResponse(reflection) ||
                'No reflection generated';

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
