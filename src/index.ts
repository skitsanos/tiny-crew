import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';
import FileWriteTool from '@/Tools/FileWriteTool';

const logger = new Logger('Mission');

const openai = new OpenAI();
const BASE_MODEL = 'gpt-4o';

const crew = new Crew(
    'Develop and present a comprehensive overview of recent AI advancements and their implications. Use all available tools to achieve this goal.',
    openai,
    BASE_MODEL
);

const agent1 = new Agent({
    name: 'Alice',
    goal: 'Conduct research and provide concise summaries',
    expectedOutput: 'Bullet points or short paragraphs',
    model: BASE_MODEL
}, openai);

const agent2 = new Agent({
    name: 'Bob',
    goal: 'Perform code writing tasks, generate code examples, and save files',
    expectedOutput: 'Confirmation that the code snippet was saved to a file',
    model: BASE_MODEL
}, openai, [new FileWriteTool()]);

const agent3 = new Agent({
    name: 'Charlie',
    goal: 'Synthesize information, create cohesive reports, and summarize overall findings',
    expectedOutput: 'Structured report with sections and summaries',
    model: BASE_MODEL
}, openai, [new FileWriteTool()]);

crew.addAgent(agent1);
crew.addAgent(agent2);
crew.addAgent(agent3);

const tasks = [
    'Research recent advancements in AI and summarize them in 3 bullet points',
    'Analyze potential cybersecurity implications of recent AI advancements',
    'Create a code example in Python that prints "Hello, World!". Save this example to a file "example.py"',
    'Synthesize the research and analysis into a coherent overview'
];

async function runCrewMission()
{
    for (const task of tasks)
    {
        try
        {
            const result = await crew.assignTask(task);
            logger.info(`Task result: ${result}`);
        }
        catch (error)
        {
            logger.error('An error occurred:', error);
        }
    }

    try
    {
        const crewSummary = await crew.achieveCrewGoal();
        logger.info('Crew goal achievement summary:', crewSummary);
    }
    catch (error)
    {
        logger.error('An error occurred while achieving crew goal:', error);
    }
}

runCrewMission();