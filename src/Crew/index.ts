import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type Agent from '@tinycrew/Agent';
import {
    type MemoryBackend,
    MemoryStore,
    type MemoryStoreConfig,
} from '@tinycrew/Memory';
import { ModelRouter } from '@tinycrew/ModelRouter';
import Logger from '@tinycrew/utils/logger';
import { withRetry } from '@tinycrew/utils/retry';
import {
    AgentEvent,
    type ConversationMessage,
    type CrewConfig,
    CrewEvent,
    TaskStatus,
} from '@tinycrew/utils/types';
import dedent from 'dedent';
import type OpenAI from 'openai';
import type {
    Response,
    ResponseInputItem,
    ResponseOutputMessage,
} from 'openai/resources/responses/responses';

/**
 * Tracks agent performance for heuristic-based task assignment
 */
interface AgentPerformanceRecord {
    successCount: number;
    failureCount: number;
    lastTaskTypes: string[]; // Keywords from recent tasks
}

/**
 * Options for creating a Crew with custom backends and routing
 */
export interface CrewOptions {
    /** Custom memory backend (default: InMemoryBackend) */
    memoryBackend?: MemoryBackend;
    /** Memory store configuration */
    memoryConfig?: MemoryStoreConfig;
    /** Model router for purpose-based model selection (default: ModelRouter.fromEnv()) */
    modelRouter?: ModelRouter;
}

/**
 * Enhanced Crew class for agent orchestration
 */
export class Crew extends EventEmitter {
    private readonly id: string;
    private readonly goal: string;
    private readonly agents: Map<string, Agent>;
    private readonly memoryStore: MemoryStore;
    private readonly logger: Logger;
    private readonly client: OpenAI;
    private readonly chatHistory: ConversationMessage[];
    private readonly taskAssignmentPrompt: string;
    private readonly summarizationPrompt: string;
    private pendingTasks: string[];
    private readonly agentPerformance: Map<string, AgentPerformanceRecord>;
    private readonly modelRouter: ModelRouter;

    /**
     * Create a new Crew instance
     */
    constructor(
        config: CrewConfig,
        client: OpenAI,
        chatHistory: ConversationMessage[] = [],
        options?: CrewOptions,
    ) {
        super();
        this.id = randomUUID();
        this.goal = config.goal;
        this.agents = new Map();
        this.client = client;
        this.chatHistory = [...chatHistory];
        this.pendingTasks = [];
        this.agentPerformance = new Map();

        this.taskAssignmentPrompt =
            config.taskAssignmentPrompt ||
            this.buildDefaultTaskAssignmentPrompt();
        this.summarizationPrompt =
            config.summarizationPrompt ||
            this.buildDefaultSummarizationPrompt();

        this.logger = new Logger('Crew');

        // Initialize memory store with optional custom backend
        this.memoryStore = new MemoryStore(
            options?.memoryBackend,
            options?.memoryConfig,
            this.logger,
        );

        // Initialize model router (defaults to env-based configuration)
        this.modelRouter = options?.modelRouter ?? ModelRouter.fromEnv();
    }

    /**
     * Build default task assignment prompt
     */
    private buildDefaultTaskAssignmentPrompt(): string {
        return dedent`
        Crew Goal: {goal}
        
        Task: {task}
        
        Available Agents:
        {agents}
        
        Based on the task requirements and the available agents' capabilities, 
        which agent is best suited to perform this task? Respond with just the name of the agent.
        If no agent is suitable, respond with "NONE".
    `;
    }

    /**
     * Build default summarization prompt
     */
    private buildDefaultSummarizationPrompt(): string {
        return dedent`
        As an AI assistant, your task is to synthesize the results of multiple tasks performed by a crew of AI agents.
        
        Crew Goal: "{goal}"
        
        Here are the results of the individual tasks:
        
        {results}
        
        Please provide a comprehensive summary that addresses the crew's goal. Your summary should:
        1. Highlight key findings from each task
        2. Identify connections between different tasks
        3. Draw overall implications or conclusions related to the crew's goal
        4. Suggest any potential next steps or areas for further investigation
        
        Format your response as a well-structured report with appropriate headings and subheadings.
        `;
    }

    /**
     * Get the crew's ID
     */
    getId(): string {
        return this.id;
    }

    /**
     * Get the crew's goal
     */
    getGoal(): string {
        return this.goal;
    }

    /**
     * Add an agent to the crew
     */
    addAgent(agent: Agent): void {
        const agentName = agent.getName();
        this.agents.set(agentName, agent);

        // Share the model router with the agent
        agent.setModelRouter(this.modelRouter);

        // Initialize performance tracking for this agent
        if (!this.agentPerformance.has(agentName)) {
            this.agentPerformance.set(agentName, {
                successCount: 0,
                failureCount: 0,
                lastTaskTypes: [],
            });
        }

        // Listen for agent events to update shared memory and track performance
        agent.on(AgentEvent.TASK_COMPLETED, (result) => {
            this.storeTaskResult(result.agent, result.task, result.result, {
                status: TaskStatus.COMPLETED,
                timestamp: result.timestamp,
                taskId: result.metadata?.taskId,
                toolsUsed: result.metadata?.toolsUsed,
            });

            // Track success and task keywords for heuristic matching
            const perf = this.agentPerformance.get(result.agent);
            if (perf) {
                perf.successCount++;
                const keywords = this.extractTaskKeywords(result.task);
                perf.lastTaskTypes = [...keywords, ...perf.lastTaskTypes].slice(
                    0,
                    10,
                );
            }
        });

        agent.on(AgentEvent.TASK_FAILED, (error) => {
            const errorMessage =
                error.error instanceof Error
                    ? error.error.message
                    : String(error.error);
            this.logger.warn(
                `Task failed for agent ${error.agent}: ${error.task}`,
                { error: errorMessage },
            );
            this.storeTaskResult(
                error.agent,
                error.task,
                `Task failed: ${errorMessage}`,
                {
                    status: TaskStatus.FAILED,
                    timestamp: error.timestamp,
                    taskId: error.metadata?.taskId,
                },
            );

            // Track failure
            const perf = this.agentPerformance.get(error.agent);
            if (perf) {
                perf.failureCount++;
            }
        });
    }

    /**
     * Remove an agent from the crew
     */
    removeAgent(agentName: string): boolean {
        return this.agents.delete(agentName);
    }

    /**
     * Get an agent by name
     */
    getAgent(agentName: string): Agent | undefined {
        return this.agents.get(agentName);
    }

    /**
     * Get all agents in the crew
     */
    getAgents(): Agent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Update the chat history
     */
    updateChatHistory(message: ConversationMessage): void {
        this.chatHistory.push(message);
    }

    /**
     * Get the chat history
     */
    getChatHistory(): ConversationMessage[] {
        return [...this.chatHistory];
    }

    /**
     * Store a task result in the memory store
     */
    private storeTaskResult(
        agent: string,
        task: string,
        result: string,
        metadata: Record<string, any> = {},
    ): void {
        const taskId = metadata.taskId || randomUUID().split('-')[0];
        const taskSlug = task.slice(0, 30).replace(/\W+/g, '_');
        const itemKey = `task_${taskId}_${taskSlug}`;

        // Store in MemoryStore
        this.memoryStore
            .set(
                this.id,
                itemKey,
                {
                    taskId,
                    agent,
                    task,
                    result,
                    toolsUsed: metadata.toolsUsed,
                    metadata: {
                        status: metadata.status,
                        timestamp: metadata.timestamp,
                    },
                },
                {
                    tags: metadata.status ? [metadata.status] : [],
                },
            )
            .catch((err) => {
                this.logger.warn('Failed to store task result:', err);
            });

        this.logger.info('Task result stored:', {
            key: itemKey,
            task: task.slice(0, 50),
            agent,
        });

        this.emit(CrewEvent.MEMORY_UPDATED, {
            crew: this.id,
            key: itemKey,
            agent,
            task,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Get the MemoryStore instance for advanced memory operations
     */
    getMemoryStore(): MemoryStore {
        return this.memoryStore;
    }

    /**
     * Get the ModelRouter instance for model selection
     */
    getModelRouter(): ModelRouter {
        return this.modelRouter;
    }

    /**
     * Load memory from the backend (useful for persistent backends like JSONFileBackend)
     */
    async loadMemory(): Promise<void> {
        await this.memoryStore.load(this.id);
        this.logger.info('Memory loaded from backend');
    }

    /**
     * Save memory to the backend (useful for persistent backends like JSONFileBackend)
     */
    async saveMemory(): Promise<void> {
        await this.memoryStore.save(this.id);
        this.logger.info('Memory saved to backend');
    }

    /**
     * Get memory statistics for this crew
     */
    async getMemoryStats(): Promise<{
        itemCount: number;
        totalTokens: number;
        oldestItem: number | null;
        newestItem: number | null;
        agentCounts: Record<string, number>;
    }> {
        return this.memoryStore.getStats(this.id);
    }

    /**
     * Build context string from memory for prompt injection
     * @param options - Configuration options
     * @param options.relevanceKeywords - Keywords to score memory relevance against (e.g., from current task)
     */
    async buildMemoryContext(options?: {
        maxTokens?: number;
        maxItems?: number;
        agent?: string;
        tags?: string[];
        relevanceKeywords?: string[];
    }): Promise<string> {
        return this.memoryStore.buildContext(this.id, {
            maxTokens: options?.maxTokens,
            maxItems: options?.maxItems,
            filter: {
                agent: options?.agent,
                tags: options?.tags,
            },
            relevanceKeywords: options?.relevanceKeywords,
        });
    }

    /**
     * Clear all memory for this crew
     */
    async clearMemory(): Promise<void> {
        await this.memoryStore.clear(this.id);
        this.logger.info('All memory cleared');
    }

    /**
     * Close the memory store (cleanup resources, flush pending writes)
     */
    async closeMemory(): Promise<void> {
        await this.memoryStore.close();
        this.logger.info('Memory store closed');
    }

    /**
     * Extract keywords from a task description for matching
     */
    private extractTaskKeywords(task: string): string[] {
        const stopWords = new Set([
            'a',
            'an',
            'the',
            'and',
            'or',
            'but',
            'in',
            'on',
            'at',
            'to',
            'for',
            'of',
            'with',
            'by',
            'from',
            'as',
            'is',
            'was',
            'are',
            'were',
            'been',
            'be',
            'have',
            'has',
            'had',
            'do',
            'does',
            'did',
            'will',
            'would',
            'could',
            'should',
            'may',
            'might',
            'must',
            'shall',
            'can',
            'need',
            'it',
            'this',
            'that',
            'these',
            'those',
            'i',
            'you',
            'he',
            'she',
            'we',
            'they',
        ]);

        return task
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length > 2 && !stopWords.has(word));
    }

    /**
     * Score an agent based on heuristics for a given task
     */
    private scoreAgentForTask(agent: Agent, taskKeywords: string[]): number {
        let score = 0;
        const agentName = agent.getName();

        // 1. Capability matching (strongest signal)
        const capabilities = agent
            .getCapabilities()
            .map((c) => c.toLowerCase());
        for (const keyword of taskKeywords) {
            if (
                capabilities.some(
                    (cap) => cap.includes(keyword) || keyword.includes(cap),
                )
            ) {
                score += 10;
            }
        }

        // 2. Tool matching (check if task mentions tools the agent has)
        const toolNames = agent.getTools().map((t) => t.name.toLowerCase());
        for (const keyword of taskKeywords) {
            if (
                toolNames.some(
                    (tool) => tool.includes(keyword) || keyword.includes(tool),
                )
            ) {
                score += 8;
            }
            // Check if task needs tools the agent has
            if (keyword === 'save' || keyword === 'write') {
                if (toolNames.some((t) => t.includes('file'))) score += 5;
            }
            if (keyword === 'scrape' || keyword === 'fetch') {
                if (
                    toolNames.some(
                        (t) => t.includes('scrape') || t.includes('web'),
                    )
                )
                    score += 5;
            }
        }

        // 3. Goal matching
        const goalWords = this.extractTaskKeywords(agent.getGoal());
        for (const keyword of taskKeywords) {
            if (goalWords.includes(keyword)) {
                score += 3;
            }
        }

        // 4. Past task success (bonus for agents with good track records)
        const perf = this.agentPerformance.get(agentName);
        if (perf) {
            const totalTasks = perf.successCount + perf.failureCount;
            if (totalTasks > 0) {
                const successRate = perf.successCount / totalTasks;
                score += Math.round(successRate * 5); // Up to 5 bonus points

                // Bonus if agent has successfully done similar tasks
                for (const keyword of taskKeywords) {
                    if (perf.lastTaskTypes.includes(keyword)) {
                        score += 2;
                    }
                }
            }
        }

        return score;
    }

    /**
     * Find a suitable agent for a task using heuristics first, then LLM fallback
     */
    private async findSuitableAgent(task: string): Promise<Agent | undefined> {
        const taskKeywords = this.extractTaskKeywords(task);
        this.logger.debug('Task keywords:', taskKeywords);

        // Score all agents using heuristics
        const scoredAgents = Array.from(this.agents.values()).map((agent) => ({
            agent,
            score: this.scoreAgentForTask(agent, taskKeywords),
        }));

        // Sort by score descending
        scoredAgents.sort((a, b) => b.score - a.score);

        this.logger.debug(
            'Agent scores:',
            scoredAgents.map((s) => ({
                name: s.agent.getName(),
                score: s.score,
            })),
        );

        // If there's a clear winner (score > 0 and significantly better than second place), use it
        if (scoredAgents.length > 0 && scoredAgents[0].score > 0) {
            const topScore = scoredAgents[0].score;
            const secondScore =
                scoredAgents.length > 1 ? scoredAgents[1].score : 0;

            // Clear winner if score is at least 5 and at least 50% better than second place
            if (
                topScore >= 5 &&
                (secondScore === 0 || topScore >= secondScore * 1.5)
            ) {
                this.logger.info(
                    `Heuristic match: ${scoredAgents[0].agent.getName()} (score: ${topScore})`,
                );
                return scoredAgents[0].agent;
            }
        }

        // Fallback to LLM for ambiguous cases
        this.logger.info(
            'Using LLM for agent selection (heuristics inconclusive)',
        );

        const agentDescriptions = Array.from(this.agents.values())
            .map((agent) => {
                const perf = this.agentPerformance.get(agent.getName());
                const perfInfo =
                    perf && perf.successCount + perf.failureCount > 0
                        ? `\n        Success rate: ${Math.round((perf.successCount / (perf.successCount + perf.failureCount)) * 100)}%`
                        : '';
                return `${agent.getName()}: ${agent.getGoal()}
        Capabilities: ${agent.getCapabilities().join(', ')}
        Tools: ${agent
            .getTools()
            .map((t) => t.name)
            .join(', ')}${perfInfo}`;
            })
            .join('\n\n');

        const prompt = this.taskAssignmentPrompt
            .replace('{goal}', this.goal)
            .replace('{task}', task)
            .replace('{agents}', agentDescriptions);

        try {
            const response = await withRetry(
                () =>
                    this.client.responses.create({
                        model: this.modelRouter.getModel('agent_selection'),
                        input: [
                            {
                                role: 'user',
                                content: prompt,
                            },
                        ],
                        temperature: 0.3,
                        max_output_tokens: 50,
                    }),
                this.logger,
                'crew:agent-selection',
            );

            const chosenAgentName =
                this.extractTextFromResponse(response)?.trim();

            if (chosenAgentName === 'NONE') {
                this.logger.warn(`No suitable agent found for task: ${task}`);
                return undefined;
            }

            // Find the agent with case-insensitive matching
            return Array.from(this.agents.values()).find(
                (agent) =>
                    agent.getName().toLowerCase() ===
                    chosenAgentName?.toLowerCase(),
            );
        } catch (error) {
            this.logger.error('Error finding suitable agent:', error);
            throw error;
        }
    }

    /**
     * Add a task to the pending tasks queue
     */
    addTask(task: string): void {
        this.pendingTasks.push(task);
        this.logger.debug(`Task added to queue: ${task}`);
    }

    /**
     * Assign and execute a task using a suitable agent
     */
    async assignTask(task: string): Promise<string> {
        const agent = await this.findSuitableAgent(task);

        if (agent) {
            this.logger.info(`Assigning task to ${agent.getName()}: ${task}`);

            this.emit(CrewEvent.TASK_ASSIGNED, {
                crew: this.id,
                agent: agent.getName(),
                task,
                timestamp: Date.now(),
            });

            try {
                // Extract keywords from task for relevance scoring
                const taskKeywords = this.extractTaskKeywords(task);

                // Build memory context for the agent (scored by task relevance)
                const memoryContext = await this.buildMemoryContext({
                    maxTokens: 4000,
                    maxItems: 10,
                    relevanceKeywords: taskKeywords,
                });

                const result = await agent.performTask(
                    task,
                    memoryContext,
                    this.chatHistory,
                );

                // Update chat history with the result
                this.updateChatHistory({
                    role: 'assistant',
                    name: agent.getName(),
                    content: result,
                });

                return result;
            } catch (error) {
                this.logger.error(`Error executing task: ${error}`);
                throw error;
            }
        } else {
            const message = `No suitable agent found for task: ${task}`;
            this.logger.warn(message);
            return message;
        }
    }

    /**
     * Execute all pending tasks in sequence
     */
    async executeAllTasks(): Promise<Record<string, string>> {
        const results: Record<string, string> = {};

        for (const task of this.pendingTasks) {
            try {
                results[task] = await this.assignTask(task);
            } catch (error) {
                this.logger.error(`Error executing task "${task}":`, error);
                results[task] =
                    `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
        }

        // Clear the queue after execution
        this.pendingTasks = [];

        return results;
    }

    /**
     * Execute tasks in parallel
     */
    async executeTasksInParallel(): Promise<Record<string, string>> {
        if (this.pendingTasks.length === 0) {
            return {};
        }

        const results: Record<string, string> = {};
        const taskPromises = this.pendingTasks.map(async (task) => {
            try {
                results[task] = await this.assignTask(task);
            } catch (error) {
                this.logger.error(`Error executing task "${task}":`, error);
                results[task] =
                    `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
        });

        await Promise.all(taskPromises);

        // Clear the queue after execution
        this.pendingTasks = [];

        return results;
    }

    /**
     * Generate a final response based on all completed tasks
     */
    async provideFinalResponse(
        instruction: string = "Format your response as a concise answer that addresses the crew's goal",
    ): Promise<string> {
        // Query all task results from memory
        const memoryItems = await this.memoryStore.query(this.id, {
            sortBy: 'recency',
            maxItems: 100,
        });

        const allResults = memoryItems
            .map(
                (item) =>
                    `Task: ${item.task}\nAgent: ${item.agent}\nResult: ${item.result}`,
            )
            .join('\n\n');

        const finalAnswerPrompt = `
    Crew Goal: "${this.goal}"

    Here are the results of the individual tasks:

    ${allResults}

    ${instruction}
    `;

        try {
            const input: ResponseInputItem[] = [
                ...this.chatHistory.map((message) =>
                    this.toResponseInputItem(message),
                ),
                this.buildMessage('user', finalAnswerPrompt),
            ];

            const response = await withRetry(
                () =>
                    this.client.responses.create({
                        model: this.modelRouter.getModel('final_response'),
                        input,
                        temperature: 0.3,
                    }),
                this.logger,
                'crew:final-response',
            );

            const finalResponse = this.extractTextFromResponse(response);
            if (finalResponse) {
                // Add the final response to shared memory
                this.storeTaskResult(
                    'AI Assistant',
                    'Final Answer',
                    finalResponse,
                );

                // Update chat history
                this.updateChatHistory({
                    role: 'assistant',
                    content: finalResponse,
                });

                return finalResponse;
            } else {
                throw new Error('No answer generated by the AI assistant');
            }
        } catch (error) {
            this.logger.error(`Error in creating answer: ${error}`);
            throw error;
        }
    }

    /**
     * Generate a comprehensive summary of all task results
     */
    async achieveCrewGoal(): Promise<string> {
        this.logger.info(`Crew working towards goal: ${this.goal}`);

        // Query all task results from memory
        const memoryItems = await this.memoryStore.query(this.id, {
            sortBy: 'recency',
            maxItems: 100,
        });

        const allResults = memoryItems
            .map(
                (item) =>
                    `Task: ${item.task}\nAgent: ${item.agent}\nResult: ${item.result}`,
            )
            .join('\n\n');

        const summaryPrompt = this.summarizationPrompt
            .replace('{goal}', this.goal)
            .replace('{results}', allResults);

        try {
            const response = await withRetry(
                () =>
                    this.client.responses.create({
                        model: this.modelRouter.getModel('goal_achievement'),
                        input: [this.buildMessage('user', summaryPrompt)],
                        temperature: 0.5,
                    }),
                this.logger,
                'crew:summary',
            );

            const summary = this.extractTextFromResponse(response);
            if (summary) {
                // Store the summary in shared memory
                this.storeTaskResult('AI Assistant', 'Final Summary', summary);

                this.emit(CrewEvent.GOAL_ACHIEVED, {
                    crew: this.id,
                    goal: this.goal,
                    summary,
                    timestamp: Date.now(),
                });

                return summary;
            } else {
                throw new Error('No summary generated by the AI assistant');
            }
        } catch (error) {
            this.logger.error(`Error in creating summary: ${error}`);

            this.emit(CrewEvent.GOAL_FAILED, {
                crew: this.id,
                goal: this.goal,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });

            throw error;
        }
    }

    private buildMessage(
        role: 'user' | 'system' | 'developer',
        content: string,
    ): ResponseInputItem {
        return {
            type: 'message',
            role,
            content: [
                {
                    type: 'input_text',
                    text: content,
                },
            ],
        };
    }

    private buildAssistantMessage(content: string): ResponseOutputMessage {
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
                    logprobs: [],
                },
            ],
        };
    }

    private toResponseInputItem(
        message: ConversationMessage,
    ): ResponseInputItem {
        if (message.role === 'assistant') {
            return this.buildAssistantMessage(message.content);
        }

        if (message.role === 'developer') {
            return this.buildMessage('developer', message.content);
        }

        return this.buildMessage(message.role, message.content);
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
}

export default Crew;
