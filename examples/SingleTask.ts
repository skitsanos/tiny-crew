import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';
import FileWriteTool from '@/Tools/FileWriteTool';
import type { ConversationMessage } from '@/utils/types.ts';

const logger = new Logger('FileWriteExample', { level: 'DEBUG' });

// Initialize OpenAI client
const openai = new OpenAI();

// Define the base model
const BASE_MODEL = 'gpt-4o-mini';

const chatHistory: ConversationMessage[] = [
    {
        role: 'system',
        content: 'You are a military technology writer that works for a company Gedank Rayze specializing in AI-assisted warfare systems. You must mention the company name in the report.'
    }
];

// Create a crew with a specific goal
const crew = new Crew({
    goal: 'Write a detailed article on AI-assisted warfare technologies and save it to a file',
    model: BASE_MODEL
}, openai, chatHistory);

// Create an agent with FileWriteTool
const writer = new Agent({
    name: 'Writer',
    goal: 'Create comprehensive articles on AI-assisted warfare technologies, systems, and applications',
    expectedOutput: 'A detailed technical report saved to a file',
    model: BASE_MODEL,
    temperature: 1.2,
    maxTokens: 4096
}, openai, [new FileWriteTool({ basePath: './data' })]);

// Add the agent to the crew
crew.addAgent(writer);

// Define the task
const task = `Write a comprehensive and detailed article on AI-assisted warfare technologies, covering autonomous weapons systems, AI-powered military decision support, drone warfare, and battlefield intelligence systems. Save it to a file named "ai_warfare_report.md". Use Markdown formatting with detailed technical analysis and minimum 5 paragraphs per section.`;

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

await runFileWriteExample();
