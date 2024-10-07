import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';

const logger = new Logger('CreativeWritingExample');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: process.env.GROQ_API_URL
});

// Define the base model
const BASE_MODEL = 'llama-3.1-70b-versatile';

const chatHistory: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
        role: 'system',
        content: 'You are a creative writing team working on a short story. Each team member has a specific role.'
    },
    {
        role: 'user',
        content: 'We need to write a short story about a time traveler who accidentally changes history.'
    }
];

// Create a crew with a specific goal
const crew = new Crew(
    'Collaborate to write a compelling short story about a time traveler',
    openai,
    BASE_MODEL,
    chatHistory
);

// Create agents for different aspects of story writing
const plotWriter = new Agent({
    name: 'Plot Developer',
    goal: 'Develop the main plot points and story structure',
    expectedOutput: 'A brief outline of the story plot',
    model: BASE_MODEL
}, openai);

const characterDesigner = new Agent({
    name: 'Character Designer',
    goal: 'Create detailed and interesting character profiles',
    expectedOutput: 'Character descriptions for the main characters',
    model: BASE_MODEL
}, openai);

const settingCreator = new Agent({
    name: 'Setting Creator',
    goal: 'Develop rich and detailed settings for the story',
    expectedOutput: 'Descriptions of the main settings in the story',
    model: BASE_MODEL
}, openai);

const dialogueWriter = new Agent({
    name: 'Dialogue Writer',
    goal: 'Write engaging and realistic dialogue for the characters',
    expectedOutput: 'Sample dialogues for key scenes',
    model: BASE_MODEL
}, openai);

// Add the agents to the crew
crew.addAgent(plotWriter);
crew.addAgent(characterDesigner);
crew.addAgent(settingCreator);
crew.addAgent(dialogueWriter);

async function runCreativeWritingExample()
{
    try
    {
        logger.info('Starting creative writing process');

        // Develop plot
        const plotTask = 'Develop a basic plot outline for a story about a time traveler accidentally changing history';
        const plotResult = await crew.assignTask(plotTask);
        logger.info('Plot developed:', plotResult);

        // Create characters
        const characterTask = 'Create profiles for the main characters in the time travel story, including the protagonist';
        const characterResult = await crew.assignTask(characterTask);
        logger.info('Characters created:', characterResult);

        // Develop settings
        const settingTask = 'Describe the main settings for the time travel story, including both past and present/future';
        const settingResult = await crew.assignTask(settingTask);
        logger.info('Settings developed:', settingResult);

        // Write key dialogues
        const dialogueTask = 'Write sample dialogues for key scenes in the time travel story';
        const dialogueResult = await crew.assignTask(dialogueTask);
        logger.info('Dialogues written:', dialogueResult);

        // Generate final story
        const finalStoryTask = 'Combine the plot, characters, settings, and dialogues to create a cohesive short story';
        const finalStoryResult = await crew.assignTask(finalStoryTask);
        logger.info('Final story created:', finalStoryResult);

        const finalResponse = await crew.provideFinalResponse('Write a complete story that captures the essence of the time travel theme');
        console.log('---\nFinal Story:\n', finalResponse, '\n---\n\n');
    }
    catch (error)
    {
        logger.error('An error occurred:', error);
    }
}

runCreativeWritingExample();