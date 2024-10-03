import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import pino from 'pino';

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
});

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: process.env.GROQ_API_URL
});

const crew = new Crew('Develop and present a comprehensive overview of recent AI advancements and their implications');

const agent1 = new Agent({
    name: 'Alice',
    goal: 'Conduct research and provide concise summaries',
    expectedOutput: 'Bullet points or short paragraphs',
    model: 'llama-3.1-70b-versatile'
}, openai);

const agent2 = new Agent({
    name: 'Bob',
    goal: 'Analyze and improve code, focusing on debugging and optimization',
    expectedOutput: 'Explanations and code snippets',
    model: 'llama-3.1-70b-versatile'
}, openai);

const agent3 = new Agent({
    name: 'Charlie',
    goal: 'Synthesize information, create cohesive reports, and summarize overall findings',
    expectedOutput: 'Structured report with sections and summaries',
    model: 'llama-3.1-70b-versatile'
}, openai);

crew.addAgent(agent1);
crew.addAgent(agent2);
crew.addAgent(agent3);

const tasks = [
    'Research recent advancements in AI and summarize them in 3 bullet points',
    'Analyze potential cybersecurity implications of recent AI advancements',
    'Create a brief code snippet demonstrating a simple AI concept',
    'Synthesize the research and analysis into a coherent overview'
];

async function runCrewMission()
{
    for (const task of tasks)
    {
        try
        {
            const result = await crew.assignTask(task);
            if (result)
            {
                logger.info(`Task result: ${result}`);
            }
            else
            {
                logger.warn(`No agent could complete the task: ${task}`);
            }
        }
        catch (error)
        {
            logger.error('An error occurred:', error);
        }
    }

    // After all individual tasks are complete, work towards the crew's goal
    const crewSummary = await crew.achieveCrewGoal();
    logger.info('Crew goal achievement summary:', crewSummary);
}

runCrewMission();