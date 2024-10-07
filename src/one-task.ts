import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';
import FileWriteTool from '@/Tools/FileWriteTool';

const logger = new Logger('FileWriteExample');

// Initialize OpenAI client
const openai = new OpenAI();

// Define the base model
const BASE_MODEL = 'gpt-4o';

const chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
        role: 'system',
        content: 'You are a writer that works for a company Gedank Rayze and you must mention the company name in the report.'
    }
];

// Create a crew with a specific goal
const crew = new Crew('Write a brief report on AI ethics and save it to a file', openai, BASE_MODEL, chatHistory);

// Create an agent with FileWriteTool
const writer = new Agent({
    name: 'Writer',
    goal: 'Create concise reports on AI-related topics and save them to files',
    expectedOutput: 'A brief report saved to a file',
    model: BASE_MODEL
}, openai, [new FileWriteTool()]);

// Add the agent to the crew
crew.addAgent(writer);

// Define the task
const task = `Write a comprehensive and detailed report on the ethical considerations of AI development 
and save it to a file named "ai_ethics_report.md". Use Markdown formatting.`;

async function runFileWriteExample()
{
    try
    {
        logger.info('Starting file write task');
        const result = await crew.assignTask(task);
        logger.info('Task completed. Result:', result);

        // Achieve the crew's goal (in this case, it's the same as the task)
        // const summary = await crew.achieveCrewGoal();
        // logger.info('Crew goal achievement summary:', summary);

        const finalResponse = await crew.provideFinalResponse();
        console.log('---\n', finalResponse, '\n---\n\n');
    }
    catch (error)
    {
        logger.error('An error occurred:', error);
    }
}

runFileWriteExample();