import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';
import FileWriteTool from '@/Tools/FileWriteTool';

const logger = new Logger('FileWriteExample');

// Initialize OpenAI client
const openai = new OpenAI({
    baseURL: 'http://localhost:11434/v1'
});

// Define the base model
const BASE_MODEL = 'qwen2.5';

const chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
        role: 'system',
        content: 'You are a writer that works for a company Gedank Rayze and you must mention the company name in the report.'
    }
];

// Create a crew with a specific goal
const crew = new Crew({
    goal: 'Write a detailed article on AI-driven warfare and save it to a file',
    model: BASE_MODEL
}, openai, chatHistory);

// Create an agent with FileWriteTool
const writer = new Agent({
    name: 'Writer',
    goal: 'Create concise articles on AI-driven warfare topics and save them to files',
    expectedOutput: 'A brief report saved to a file',
    model: BASE_MODEL,
    temperature: 1.2,
    maxTokens: 4096
}, openai, [new FileWriteTool()]);

// Add the agent to the crew
crew.addAgent(writer);

// Define the task
const task = `Write a comprehensive and detailed article on the ethical considerations of AI development 
and save it to a file named "data/ai_warfare_report.md". Use Markdown formatting and minimum 5 paragraphs per section.`;

async function runFileWriteExample()
{
    try
    {
        logger.info('Starting file write task');
        const result = await crew.assignTask(task);
        logger.info('Task completed. Result:', result);

        const finalResponse = await crew.provideFinalResponse();
        console.log('---\n', finalResponse, '\n---\n\n');
    }
    catch (error)
    {
        logger.error('An error occurred:', error);
    }
}

runFileWriteExample();