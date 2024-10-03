import Agent from '@/Agent';
import Logger from '@/utils/logger';
import OpenAI from 'openai';

interface SharedMemory
{
    [key: string]: any;
}

class Crew
{
    private agents: Agent[] = [];
    private goal: string;
    private sharedMemory: SharedMemory = {};
    private logger = new Logger('Crew');
    private llm: OpenAI = new OpenAI();
    private model: string = 'gpt-4o';

    constructor(goal: string, llm: OpenAI, model: string = 'gpt-4o')
    {
        this.goal = goal;
        this.llm = llm;
        this.model = model;
    }

    addAgent(agent: Agent): void
    {
        this.agents.push(agent);
    }

    private updateSharedMemory(agent: string, task: string, result: string): void
    {
        this.sharedMemory[task] = {
            agent,
            result
        };
        this.logger.info('Shared memory updated:', this.sharedMemory);
    }

    private async findSuitableAgent(task: string): Promise<Agent | undefined>
    {
        const agentDescriptions = this.agents.map(agent =>
            `${agent.getName()}: ${agent.getGoal()}. Tools: ${agent.getTools().map(t => t.name).join(', ')}`
        ).join('\n');

        const prompt = `
            Task: ${task}

            Available Agents:
            ${agentDescriptions}

            Based on the task requirements and the available agents' capabilities, 
            which agent is best suited to perform this task? Respond with just the name of the agent.
        `;

        const response = await this.llm.chat.completions.create({
            model: this.model,
            messages: [{
                role: 'user',
                content: prompt
            }],
            temperature: 0.3
        });

        const chosenAgentName = response.choices[0].message.content?.trim();
        return this.agents.find(agent => agent.getName().toLowerCase() === chosenAgentName?.toLowerCase());
    }

    async assignTask(task: string): Promise<string>
    {
        const availableAgent = await this.findSuitableAgent(task);

        if (availableAgent)
        {
            this.logger.info(`Assigning task to ${availableAgent.getName()}: ${task}`);
            const result = await availableAgent.performTask(task, this.sharedMemory);
            this.updateSharedMemory(availableAgent.getName(), task, result);
            return result;
        }
        else
        {
            const message = `No suitable agent found for task: ${task}`;
            this.logger.warn(message);
            return message;
        }
    }

    async achieveCrewGoal(): Promise<string>
    {
        this.logger.info(`Crew working towards goal: ${this.goal}`);

        const allResults = Object.entries(this.sharedMemory)
                                 .map(([task, data]) => `Task: ${task}\nAgent: ${data.agent}\nResult: ${data.result}`)
                                 .join('\n\n');

        const summaryPrompt = `
            As an AI assistant, your task is to synthesize the results of multiple tasks performed by a crew of AI agents.

            Crew Goal: "${this.goal}"

            Here are the results of the individual tasks:

            ${allResults}

            Please provide a comprehensive summary that addresses the crew's goal. Your summary should:
            1. Highlight key findings from each task
            2. Identify connections between different tasks
            3. Draw overall implications or conclusions related to the crew's goal
            4. Suggest any potential next steps or areas for further investigation

            Format your response as a well-structured report with appropriate headings and subheadings.
        `;

        try
        {
            const response = await this.llm.chat.completions.create({
                model: this.model,
                messages: [{
                    role: 'user',
                    content: summaryPrompt
                }],
                temperature: 0.5
            });

            const summary = response.choices[0].message.content;
            if (summary)
            {
                this.updateSharedMemory('AI Assistant', 'Final Summary', summary);
                return summary;
            }
            else
            {
                throw new Error('No summary generated by the AI assistant');
            }
        }
        catch (error)
        {
            this.logger.error(`Error in creating summary: ${error}`);
            throw error;
        }
    }

    getSharedMemory(): SharedMemory
    {
        return this.sharedMemory;
    }
}

export default Crew;