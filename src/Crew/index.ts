import Agent from '@/Agent';
import pino from 'pino';

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

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
        agent.on('taskComplete', this.handleTaskComplete.bind(this));
        agent.on('taskError', this.handleTaskError.bind(this));
    }

    private handleTaskComplete(result: { agent: string; task: string; result: string }): void {
        logger.info(`Task completed by ${result.agent}: ${result.task}`);
        logger.info(`Result: ${result.result}`);
        this.updateSharedMemory(result.agent, result.task, result.result);
    }

    private handleTaskError(error: { agent: string; task: string; error: Error }): void {
        logger.error(`Task error by ${error.agent}: ${error.task}`);
        logger.error(`Error: ${error.error}`);
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

    async assignTask(task: string): Promise<string | null> {
        const availableAgent = this.findSuitableAgent(task);

        if (availableAgent) {
            logger.info(`Assigning task to ${availableAgent.getName()}: ${task}`);
            const result = await availableAgent.performTask(task, this.sharedMemory);
            return result;
        } else {
            logger.warn(`No suitable agent found for task: ${task}`);
            return null;
        }
    }

    async achieveCrewGoal(): Promise<string> {
        logger.info(`Crew working towards goal: ${this.goal}`);

        // Compile all the results from the shared memory
        const allResults = Object.entries(this.sharedMemory)
                                 .map(([task, data]) => `Task: ${task}\nResult: ${data.result}`)
                                 .join('\n\n');

        // Find the agent best suited for summarization
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

            const summary = await summaryAgent.performTask(summaryTask, this.sharedMemory);
            return summary;
        } else {
            return `Unable to summarize progress towards goal: ${this.goal}. No suitable agent found for summarization.`;
        }
    }

    getSharedMemory(): SharedMemory {
        return this.sharedMemory;
    }
}

export default Crew;