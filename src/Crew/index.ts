import {EventEmitter} from 'events';
import {randomUUID} from 'crypto';
import type OpenAI from 'openai';
import type Agent from '@/Agent';
import {AgentEvent, type CrewConfig, CrewEvent, TaskStatus, type LlmConfig, type SharedMemory} from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';
import dedent from 'dedent';

/**
 * Enhanced Crew class for agent orchestration
 */
export class Crew extends EventEmitter {
    private readonly id: string;
    private readonly goal: string;
    private readonly agents: Map<string, Agent>;
    private readonly sharedMemory: SharedMemory;
    private readonly logger: Logger;
    private readonly llmConfig: LlmConfig;
    private readonly client: OpenAI;
    private readonly chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    private readonly taskAssignmentPrompt: string;
    private readonly summarizationPrompt: string;
    private pendingTasks: string[];

    /**
     * Create a new Crew instance
     */
    constructor(
        config: CrewConfig,
        client: OpenAI,
        chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
    ) {
        super();
        this.id = randomUUID();
        this.goal = config.goal;
        this.agents = new Map();
        this.sharedMemory = {};
        this.client = client;
        this.chatHistory = [...chatHistory];
        this.pendingTasks = [];

        this.llmConfig = {
            model: config.model || 'gpt-4o-mini',
            temperature: config.temperature || 0.5,
            maxTokens: config.maxTokens || 1024
        };

        this.taskAssignmentPrompt = config.taskAssignmentPrompt || this.buildDefaultTaskAssignmentPrompt();
        this.summarizationPrompt = config.summarizationPrompt || this.buildDefaultSummarizationPrompt();

        this.logger = new Logger('Crew');
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
        this.agents.set(agent.getName(), agent);

        // Listen for agent events to update shared memory
        agent.on(AgentEvent.TASK_COMPLETED, (result) => {
            this.updateSharedMemory(result.agent, result.task, result.result, {
                status: TaskStatus.COMPLETED,
                timestamp: result.timestamp,
                taskId: result.metadata?.taskId,
                toolsUsed: result.metadata?.toolsUsed
            });
        });

        agent.on(AgentEvent.TASK_FAILED, (error) => {
            const errorMessage = error.error instanceof Error ? error.error.message : String(error.error);
            this.logger.warn(`Task failed for agent ${error.agent}: ${error.task}`, { error: errorMessage });
            this.updateSharedMemory(error.agent, error.task, `Task failed: ${errorMessage}`, {
                status: TaskStatus.FAILED,
                timestamp: error.timestamp,
                taskId: error.metadata?.taskId
            });
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
    updateChatHistory(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): void {
        this.chatHistory.push(message);
    }

    /**
     * Get the chat history
     */
    getChatHistory(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        return [...this.chatHistory];
    }

    /**
     * Update the shared memory
     */
    private updateSharedMemory(agent: string, task: string, result: string, metadata: Record<string, any> = {}): void {
        const itemKey = `task_${task.slice(0, 20).replace(/\W+/g, '_')}`;

        this.sharedMemory[itemKey] = {
            key: itemKey,
            value: {
                task,
                result
            },
            agent,
            timestamp: Date.now(),
            metadata
        };

        this.logger.info('Shared memory updated:', { task, agent });

        this.emit(CrewEvent.MEMORY_UPDATED, {
            crew: this.id,
            memory: this.sharedMemory,
            update: {
                key: itemKey,
                agent,
                task,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Get the shared memory
     */
    getSharedMemory(): SharedMemory {
        return { ...this.sharedMemory };
    }

    /**
     * Find a suitable agent for a task
     */
    private async findSuitableAgent(task: string): Promise<Agent | undefined> {
        const agentDescriptions = Array.from(this.agents.values())
                                       .map(agent =>
                                           `${agent.getName()}: ${agent.getGoal()}
        Capabilities: ${agent.getCapabilities().join(', ')}
        Tools: ${agent.getTools().map(t => t.name).join(', ')}`
                                       )
                                       .join('\n\n');

        const prompt = this.taskAssignmentPrompt
                           .replace('{goal}', this.goal)
                           .replace('{task}', task)
                           .replace('{agents}', agentDescriptions);

        try {
            const response = await this.client.chat.completions.create({
                model: this.llmConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.3,
                max_tokens: 50 // Short response needed
            });

            const chosenAgentName = response.choices[0].message.content?.trim();

            if (chosenAgentName === 'NONE') {
                this.logger.warn(`No suitable agent found for task: ${task}`);
                return undefined;
            }

            // Find the agent with case-insensitive matching
            return Array.from(this.agents.values()).find(
                agent => agent.getName().toLowerCase() === chosenAgentName?.toLowerCase()
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
                timestamp: Date.now()
            });

            try {
                const result = await agent.performTask(task, this.sharedMemory, this.chatHistory);

                // Update chat history with the result
                this.updateChatHistory({
                    role: 'assistant',
                    name: agent.getName(),
                    content: result
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
                results[task] = `Error: ${error instanceof Error ? error.message : String(error)}`;
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
                results[task] = `Error: ${error instanceof Error ? error.message : String(error)}`;
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
    async provideFinalResponse(instruction: string = 'Format your response as a concise answer that addresses the crew\'s goal'): Promise<string> {
        const allResults = Object.values(this.sharedMemory)
                                 .map(item => `Task: ${item.value.task}\nAgent: ${item.agent}\nResult: ${item.value.result}`)
                                 .join('\n\n');

        const finalAnswerPrompt = `
    Crew Goal: "${this.goal}"
    
    Here are the results of the individual tasks:
    
    ${allResults}
    
    ${instruction}
    `;

        try {
            const response = await this.client.chat.completions.create({
                model: this.llmConfig.model,
                messages: [
                    ...this.chatHistory,
                    { role: 'user', content: finalAnswerPrompt }
                ],
                temperature: 0.3
            });

            const finalResponse = response.choices[0].message.content;
            if (finalResponse) {
                // Add the final response to shared memory
                this.updateSharedMemory('AI Assistant', 'Final Answer', finalResponse);

                // Update chat history
                this.updateChatHistory({
                    role: 'assistant',
                    content: finalResponse
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

        // Format results for the summary prompt
        const allResults = Object.values(this.sharedMemory)
                                 .map(item => `Task: ${item.value.task}\nAgent: ${item.agent}\nResult: ${item.value.result}`)
                                 .join('\n\n');

        const summaryPrompt = this.summarizationPrompt
                                  .replace('{goal}', this.goal)
                                  .replace('{results}', allResults);

        try {
            const response = await this.client.chat.completions.create({
                model: this.llmConfig.model,
                messages: [{ role: 'user', content: summaryPrompt }],
                temperature: 0.5
            });

            const summary = response.choices[0].message.content;
            if (summary) {
                // Store the summary in shared memory
                this.updateSharedMemory('AI Assistant', 'Final Summary', summary);

                this.emit(CrewEvent.GOAL_ACHIEVED, {
                    crew: this.id,
                    goal: this.goal,
                    summary,
                    timestamp: Date.now()
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
                timestamp: Date.now()
            });

            throw error;
        }
    }
}

export default Crew;
