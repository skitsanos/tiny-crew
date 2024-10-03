import OpenAI from 'openai';
import {EventEmitter} from 'events';
import type {AgentConfig, TaskError, TaskResult, Tool} from '@/utils/types';
import Logger from '@/utils/logger';

interface AgentLlmConfig
{
    model: string;
    client: OpenAI;
    systemPrompt?: string;
    tools?: Tool[];
}

class Agent extends EventEmitter
{
    private name: string;
    private goal: string;
    private expectedOutput?: string;
    private llmConfig: AgentLlmConfig;
    private logger: Logger;

    constructor(config: AgentConfig, client: OpenAI, tools: Tool[] = [])
    {
        super();
        this.name = config.name;
        this.goal = config.goal;
        this.expectedOutput = config.expectedOutput;
        this.llmConfig = {
            model: config.model ?? 'gpt-4o',
            client: client,
            tools: tools
        };
        this.logger = new Logger(`Agent-${this.name}`);
    }

    getName(): string
    {
        return this.name;
    }

    getGoal(): string
    {
        return this.goal;
    }

    getExpectedOutput(): string | undefined
    {
        return this.expectedOutput;
    }

    async performTask(task: string, sharedMemory: any): Promise<string>
    {
        this.logger.trace(`Performing task: ${task}`);

        const messages: OpenAI.ChatCompletionMessage[] = [
            {
                role: 'system',
                content: `You are ${this.name}, an AI assistant with the goal: ${this.goal}.`
            },
            {
                role: 'system',
                content: `Shared crew knowledge: ${JSON.stringify(sharedMemory)}`
            },
            {
                role: 'user',
                content: task
            }
        ];

        if (this.expectedOutput)
        {
            messages.push({
                role: 'system',
                content: `Expected output format: ${this.expectedOutput}`
            });
        }

        try
        {
            const completion = await this.llmConfig.client.chat.completions.create({
                model: this.llmConfig.model,
                messages: messages,
                ...(this.llmConfig.tools && this.llmConfig.tools.length > 0 ? {
                    tool_choice: 'auto',
                    tools: this.llmConfig.tools.map(tool => ({
                        type: 'function',
                        function: tool.schema
                    }))
                } : {})
            });

            const responseMessage = completion.choices[0].message;

            if (responseMessage.content)
            {
                this.emit('taskComplete', {
                    agent: this.name,
                    task,
                    result: responseMessage.content
                } as TaskResult);
                return responseMessage.content;
            }
            else if (responseMessage.tool_calls)
            {
                // Handle tool calls if necessary
                // This part would need to be implemented if you want to use tools in the future
                throw new Error('Tool calls are not implemented in this version');
            }
            else
            {
                throw new Error('Unexpected response from LLM');
            }
        }
        catch (error)
        {
            this.logger.error(`Error performing task: ${error}`);
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