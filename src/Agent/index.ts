import OpenAI from 'openai';
import { EventEmitter } from 'events';
import type { AgentConfig, TaskError, TaskResult } from '@/utils/types';

class Agent extends EventEmitter {
    private name: string;
    private goal: string;
    private expectedOutput?: string;
    private aiClient: OpenAI;
    private readonly model: string;

    constructor(config: AgentConfig, aiClient: OpenAI) {
        super();
        this.name = config.name;
        this.goal = config.goal;
        this.expectedOutput = config.expectedOutput;
        this.aiClient = aiClient;
        this.model = config.model || 'gpt-4';
    }

    getName(): string {
        return this.name;
    }

    getGoal(): string {
        return this.goal;
    }

    getExpectedOutput(): string | undefined {
        return this.expectedOutput;
    }

    async performTask(task: string, sharedMemory: any): Promise<string> {
        console.log(`Agent ${this.name} is performing task: ${task}`);

        try {
            const messages = [
                { role: 'system' as const, content: `You are ${this.name}, an AI assistant with the goal: ${this.goal}.` },
                { role: 'system' as const, content: `Shared crew knowledge: ${JSON.stringify(sharedMemory)}` },
                { role: 'user' as const, content: task }
            ];

            if (this.expectedOutput) {
                messages.push({ role: 'system' as const, content: `Expected output format: ${this.expectedOutput}` });
            }

            const response = await this.aiClient.chat.completions.create({
                model: this.model,
                messages: messages
            });

            const result = response.choices[0].message.content;
            if (result) {
                this.emit('taskComplete', {
                    agent: this.name,
                    task,
                    result
                } as TaskResult);
                return result;
            } else {
                throw new Error('No result from AI provider');
            }
        } catch (error) {
            console.error(`Error performing task: ${error}`);
            this.emit('taskError', {
                agent: this.name,
                task,
                error: error instanceof Error ? error : new Error(String(error))
            } as TaskError);
            throw error;
        }
    }
}

export default Agent;