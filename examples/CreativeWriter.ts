import OpenAI from 'openai';
import path from 'path';
import Logger from '@/utils/logger.ts';
import * as process from 'node:process';
import FileWriteTool from '@/Tools/FileWriteTool';
import {AgentEvent, CrewEvent} from '@/utils/types.ts';
import dedent from 'dedent';
import Crew from '@/Crew';
import Agent from '@/Agent';

// Initialize logger
const logger = new Logger('CreativeWritingCrew', {colorize: true});

async function runCreativeWritingExample()
{
    logger.info('Initializing Creative Writing Crew...');

    const {
        GROQ_API_KEY,
        GROQ_API_URL
    } = process.env;

    // Configure OpenAI client
    if (!GROQ_API_KEY)
    {
        logger.fatal('GROQ_API_KEY environment variable not set');
        process.exit(1);
    }

    if (!GROQ_API_URL)
    {
        logger.fatal('GROQ_API_URL environment variable not set');
        process.exit(1);
    }

    const openai = new OpenAI({
        apiKey: GROQ_API_KEY,
        baseURL: GROQ_API_URL
    });
    const baseModel = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

    // Create output directory for story files
    const outputDir = path.join(process.cwd(), 'output', 'story');

    // Initialize tools
    const fileWriteTool = new FileWriteTool({
        basePath: outputDir,
        allowedExtensions: [
            '.txt',
            '.md',
            '.json'
        ],
        logger: new Logger('FileWriteTool')
    });

    // Create the crew with a specific creative writing goal
    const storyTheme = process.env.STORY_THEME || 'a time traveler accidentally changing history';
    const storyGenre = process.env.STORY_GENRE || 'science fiction';

    const crew = new Crew(
        {
            goal: `Collaboratively create a compelling ${storyGenre} short story about ${storyTheme} with well-developed plot, characters, settings, and dialogue.`,
            model: baseModel,
            temperature: 0.7,
            metadata: {
                projectName: 'Creative Writing Crew',
                theme: storyTheme,
                genre: storyGenre
            }
        },
        openai
    );

    // Set up event listeners for monitoring the writing process
    crew.on(CrewEvent.TASK_ASSIGNED, (data) =>
    {
        logger.debug(`Writing task assigned to ${data.agent}: ${data.task.substring(0, 50)}...`);
    });

    crew.on(CrewEvent.MEMORY_UPDATED, (data) =>
    {
        logger.debug(`Story component updated by ${data.update.agent}: ${data.update.key}`);
    });

    crew.on(CrewEvent.GOAL_ACHIEVED, (data) =>
    {
        logger.info('Story creation complete!', {timestamp: new Date(data.timestamp).toISOString()});
    });

    // Create specialized writing agents
    const plotWriter = new Agent({
        name: 'Plot Developer',
        goal: 'Develop engaging, coherent plot points and story structure with clear beginning, middle, and end',
        expectedOutput: 'A detailed outline of the story plot with major story beats and narrative arc',
        model: baseModel,
        capabilities: [
            'plot_development',
            'story_structure',
            'narrative_arc'
        ],
        temperature: 0.7,
        systemPrompt: `You are a master plot developer who specializes in creating engaging ${storyGenre} narratives.
    You excel at crafting compelling story arcs with interesting plot twists and satisfying resolutions.
    Focus on creating a coherent narrative structure for a story about ${storyTheme}.
    Always ensure your plots have a clear beginning (setup), middle (conflict), and end (resolution).`
    }, openai, [fileWriteTool]);

    const characterDesigner = new Agent({
        name: 'Character Designer',
        goal: 'Create multi-dimensional characters with distinct personalities, motivations, backgrounds and arcs',
        expectedOutput: 'Detailed character profiles with physical descriptions, personalities, motivations, and growth arcs',
        model: baseModel,
        capabilities: [
            'character_development',
            'motivation_design',
            'character_arcs'
        ],
        temperature: 0.7,
        systemPrompt: `You are a skilled character designer who creates memorable and realistic characters for ${storyGenre} stories.
    You excel at developing characters with depth, unique personalities, clear motivations, and compelling arcs.
    For this story about ${storyTheme}, create characters that readers will connect with emotionally.
    Include physical descriptions, psychological traits, backgrounds, and how they might change through the story.`
    }, openai, [fileWriteTool]);

    const settingCreator = new Agent({
        name: 'Setting Creator',
        goal: 'Develop immersive, vivid settings that enhance the story and influence the characters and plot',
        expectedOutput: 'Richly detailed descriptions of the primary locations where the story unfolds',
        model: baseModel,
        capabilities: [
            'world_building',
            'environmental_descriptions',
            'sensory_details'
        ],
        temperature: 0.8,
        systemPrompt: dedent`
        You are an expert setting creator who builds immersive worlds for ${storyGenre} stories.
        You excel at crafting vivid locations with rich sensory details that bring settings to life.
        For this story about ${storyTheme}, create settings that not only serve as backdrops but also influence the plot and characters.
        Include visual, auditory, olfactory, and tactile details in your descriptions.`
        }, openai, [fileWriteTool]);

    const dialogueWriter = new Agent({
        name: 'Dialogue Writer',
        goal: 'Write authentic, character-driven dialogue that advances the plot and reveals character traits',
        expectedOutput: 'Natural-sounding dialogue exchanges for key scenes that reveal character and advance the plot',
        model: baseModel,
        capabilities: [
            'dialogue_creation',
            'voice_distinction',
            'subtext'
        ],
        temperature: 0.8,
        systemPrompt: dedent`
        You are a talented dialogue writer who creates authentic conversations for ${storyGenre} stories.
        You excel at giving each character a distinct voice that reflects their personality and background.
        For this story about ${storyTheme}, write dialogue that sounds natural, reveals character traits, and advances the plot.
        Focus on subtext, conflict, and emotional resonance in conversations.`
        }, openai, [fileWriteTool]);

    const finalEditor = new Agent({
        name: 'Story Editor',
        goal: 'Integrate all elements into a cohesive, polished story with consistent tone, pacing, and style',
        expectedOutput: 'A complete, edited short story that seamlessly combines plot, characters, settings, and dialogue',
        model: baseModel,
        capabilities: [
            'narrative_integration',
            'prose_refinement',
            'consistency_checking',
            'file_management'
        ],
        temperature: 0.6,
        systemPrompt: dedent`
        You are a skilled story editor who excels at integrating various story elements into cohesive narratives.
        You take existing plot outlines, character profiles, setting descriptions, and dialogue, and weave them into a seamless ${storyGenre} story.
        For this story about ${storyTheme}, ensure consistent tone, pacing, and style throughout.
        Focus on creating engaging prose that brings all elements together into a polished final piece.`
        }, openai, [fileWriteTool]);

    // Add event listeners to log agent activities
    for (const agent of [
        plotWriter,
        characterDesigner,
        settingCreator,
        dialogueWriter,
        finalEditor
    ])
    {
        agent.on(AgentEvent.TASK_STARTED, (data) =>
        {
            logger.debug(`${agent.getName()} started work on: ${data.task.substring(0, 40)}...`);
        });

        agent.on(AgentEvent.TASK_COMPLETED, (data) =>
        {
            logger.info(`${agent.getName()} completed: ${data.task.substring(0, 40)}...`);
        });
    }

    // Add the agents to the crew
    crew.addAgent(plotWriter);
    crew.addAgent(characterDesigner);
    crew.addAgent(settingCreator);
    crew.addAgent(dialogueWriter);
    crew.addAgent(finalEditor);

    try
    {
        logger.info('Starting creative writing process for: ' + storyTheme);

        // Add specific writing tasks to the crew
        crew.addTask(`Develop a comprehensive plot outline for a ${storyGenre} story about ${storyTheme}. Include 5-7 major plot points, a clear beginning, middle, and end. Establish the central conflict and resolution approach.`);

        crew.addTask(`Create profiles for 3-5 main characters in the ${storyGenre} story about ${storyTheme}. For each character, include their name, age, physical description, personality traits, background, motivations, and their role in the story. Ensure characters have contrasting personalities and unique voices.`);

        crew.addTask(`Describe 3-4 primary settings for the ${storyGenre} story about ${storyTheme}. For each setting, provide a vivid description including visual details, atmosphere, time period, and how the setting influences the characters and plot. Include sensory details to make settings immersive.`);

        crew.addTask(`Write sample dialogues for 3-4 key scenes in the ${storyGenre} story about ${storyTheme}. Each dialogue sample should reveal character personalities, advance the plot, and contain emotional depth. Ensure each character has a distinct voice reflecting their personality and background.`);

        // Execute all the preparatory tasks
        logger.info('Developing story components...');
        await crew.executeAllTasks();

        // Final integration task
        logger.info('Integrating story components into final narrative...');
        const integrationTask = `Review all the developed story elements and write a complete, cohesive ${storyGenre} short story about ${storyTheme}. Integrate the plot structure, characters, settings, and dialogue into a polished narrative with approximately 2000-3000 words. The story should have a clear beginning, middle, and end with smooth transitions between scenes and a satisfying conclusion.`;

        const integrationResult = await crew.assignTask(integrationTask);

        // Save the final story
        await fileWriteTool.use({
            filename: 'final_story.md',
            content: integrationResult
        });

        // Generate a reflection on the creative process
        logger.info('Generating author\'s reflection on the creative process...');
        const reflectionPrompt = 'Provide a brief reflection on the creative writing process. Discuss how the different elements (plot, characters, settings, dialogue) came together to form the final story, any challenges in integration, and insights about this collaborative approach to storytelling.';

        const reflection = await crew.provideFinalResponse(reflectionPrompt);

        await fileWriteTool.use({
            filename: 'authors_reflection.md',
            content: reflection
        });

        logger.info('Creative writing process complete! Files saved to output/story directory');
        logger.info(`Final story saved as "final_story.md"`);
        logger.info(`Author's reflection saved as "authors_reflection.md"`);

        // Return both the story and reflection for display
        return {
            story: integrationResult,
            reflection: reflection
        };
    }
    catch (error)
    {
        logger.error('An error occurred during the creative writing process:', error);
        throw error;
    }
}

// If running directly, execute the example

runCreativeWritingExample()
    .then(({story}) =>
    {
        console.log('\n=== FINAL STORY PREVIEW (First 500 chars) ===\n');
        console.log(story.substring(0, 500) + '...');
        console.log('\nFull story available in output/story/final_story.md');
    })
    .catch(error =>
    {
        console.error('Failed to run creative writing example:', error);
        process.exit(1);
    });
