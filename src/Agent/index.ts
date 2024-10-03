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

    getTools(): Tool[]
    {
        return this.llmConfig.tools || [];
    }

    hasTool(toolName: string): boolean
    {
        return this.getTools().some(tool => tool.name === toolName);
    }

    async performTask(task: string, sharedMemory: any): Promise<string>
    {
        this.logger.trace(`Performing task: ${task}`);

        const messages: OpenAI.ChatCompletionMessageParam[] = [
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
                this.logger.info('Tool calls requested by LLM');
                let finalResult = '';

                for (const toolCall of responseMessage.tool_calls)
                {
                    const {
                        name,
                        arguments: args
                    } = toolCall.function;
                    const tool = this.llmConfig.tools?.find(t => t.name === name);

                    if (tool)
                    {
                        this.logger.debug(`Executing tool ${name} with args: ${args}`);

                        try
                        {
                            const parsedArgs = JSON.parse(args);
                            const result = await tool.use(parsedArgs);
                            finalResult += `Tool ${name} result: ${JSON.stringify(result)}\n`;

                            // Add the tool result to the conversation
                            messages.push({
                                role: 'function',
                                name: name,
                                content: JSON.stringify(result)
                            });
                        }
                        catch (error)
                        {
                            this.logger.error(`Error executing tool ${name}: ${error}`);
                            finalResult += `Error executing tool ${name}: ${error}\n`;
                        }
                    }
                    else
                    {
                        this.logger.warn(`Tool ${name} not found`);
                        finalResult += `Tool ${name} not found\n`;
                    }
                }

                // After executing all tool calls, ask the LLM to summarize the results
                messages.push({
                    role: 'user',
                    content: `Based on the tool results, please provide a final response for the task: ${task}`
                });

                const summaryCompletion = await this.llmConfig.client.chat.completions.create({
                    model: this.llmConfig.model,
                    messages: messages
                });

                const summaryResponse = summaryCompletion.choices[0].message.content;
                if (summaryResponse)
                {
                    finalResult += `Final response: ${summaryResponse}`;
                }

                this.emit('taskComplete', {
                    agent: this.name,
                    task,
                    result: finalResult
                } as TaskResult);

                return finalResult;
            }
            else
            {
                this.logger.error('Unexpected response from LLM');
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