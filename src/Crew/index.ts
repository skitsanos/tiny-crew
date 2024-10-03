import Agent from '@/Agent';
import Logger from '@/utils/logger';

const logger = new Logger('Crew');

interface SharedMemory {
    [key: string]: any;
}

class Crew {
    private agents: Agent[] = [];
    private goal: string;
    private sharedMemory: SharedMemory = {};

    constructor(goal: string) {
        this.goal = goal;
    }

    addAgent(agent: Agent): void {
        this.agents.push(agent);
    }

    private updateSharedMemory(agent: string, task: string, result: string): void {
        this.sharedMemory[task] = { agent, result };
        logger.info('Shared memory updated:', this.sharedMemory);
    }

    private findSuitableAgent(task: string): Agent | undefined {
        return this.agents.find(agent =>
            task.toLowerCase().split(' ').some(word =>
                agent.getGoal().toLowerCase().includes(word)
            )
        );
    }

    async assignTask(task: string): Promise<string> {
        const availableAgent = this.findSuitableAgent(task);

        if (availableAgent) {
            logger.info(`Assigning task to ${availableAgent.getName()}: ${task}`);
            try {
                const result = await availableAgent.performTask(task, this.sharedMemory);
                this.updateSharedMemory(availableAgent.getName(), task, result);
                return result;
            } catch (error) {
                logger.error(`Error in task execution: ${error}`);
                throw error;
            }
        } else {
            const message = `No suitable agent found for task: ${task}`;
            logger.warn(message);
            return message;
        }
    }

    async achieveCrewGoal(): Promise<string> {
        logger.info(`Crew working towards goal: ${this.goal}`);

        const allResults = Object.entries(this.sharedMemory)
                                 .map(([task, data]) => `Task: ${task}\nResult: ${data.result}`)
                                 .join('\n\n');

        const summaryAgent = this.findSuitableAgent('summarize') || this.agents[0];

        if (summaryAgent) {
            const summaryTask = `
                As the crew, we have been working towards the following goal: "${this.goal}"
                Here are the results of our individual tasks:

                ${allResults}

                Please synthesize these results into a cohesive summary that addresses our crew's goal. 
                The summary should highlight key findings, connections between different tasks, 
                and overall implications or conclusions related to our goal.
            `;

            try {
                const summary = await summaryAgent.performTask(summaryTask, this.sharedMemory);
                this.updateSharedMemory(summaryAgent.getName(), 'Final Summary', summary);
                return summary;
            } catch (error) {
                logger.error(`Error in creating summary: ${error}`);
                throw error;
            }
        } else {
            return `Unable to summarize progress towards goal: ${this.goal}. No suitable agent found for summarization.`;
        }
    }

    getSharedMemory(): SharedMemory {
        return this.sharedMemory;
    }
}

export default Crew;