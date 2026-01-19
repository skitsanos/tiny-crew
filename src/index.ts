/**
 * TinyCrew - A simple example of using the TinyCrew library to manage a team of AI agents
 * to complete a series of tasks and generate a comprehensive report.
 *
 * More examples can bed found in the examples folder.
 */
import {Crew} from './Crew';
import {Agent} from './Agent';
import OpenAI from 'openai';
import {FileWriteTool} from './Tools/FileWriteTool';
import Logger from '@/utils/logger.ts';
import {CrewEvent} from '@/utils/types.ts';
import dedent from 'dedent';

// Initialize logger
const logger = new Logger('TinyCrew', {
    level: process.env.LOG_LEVEL || 'INFO',
    colorize: true
});

async function main()
{
    logger.info('Starting TinyCrew mission...');

    // Configure OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
    {
        logger.fatal('OPENAI_API_KEY environment variable not set');
        process.exit(1);
    }

    const openai = new OpenAI({apiKey});
    const baseModel = process.env.DEFAULT_MODEL || 'gpt-4o-mini';

    // Initialize tools
    const fileWriteTool = new FileWriteTool({
        basePath: process.env.FILE_WRITE_BASE_PATH || './output',
        allowedExtensions: [
            '.txt',
            '.md',
            '.json',
            '.js',
            '.ts',
            '.py',
            '.html',
            '.css'
        ],
        logger: new Logger('FileWriteTool')
    });

    // Configure crew
    const crew = new Crew(
        {
            goal: 'Develop and present a comprehensive overview of recent AI advancements and their implications. Use all available tools to achieve this goal.',
            model: baseModel,
            temperature: 0.7,
            metadata: {
                projectName: 'AI Trends Analysis',
                version: '1.0.0'
            }
        },
        openai
    );

    // Set up event listeners for monitoring
    crew.on(CrewEvent.TASK_ASSIGNED, (data) =>
    {
        logger.debug('Task assigned:', data);
    });

    crew.on(CrewEvent.MEMORY_UPDATED, (data) =>
    {
        logger.debug('Memory updated:', {
            key: data.update.key,
            agent: data.update.agent
        });
    });

    crew.on(CrewEvent.GOAL_ACHIEVED, (data) =>
    {
        logger.info('Crew goal achieved!', {timestamp: new Date(data.timestamp).toISOString()});
    });

    // Create specialized agents
    const researchAgent = new Agent({
        name: 'Alice',
        goal: 'Conduct research and provide concise summaries',
        expectedOutput: 'Bullet points or short paragraphs',
        model: baseModel,
        capabilities: [
            'research',
            'summarization',
            'analysis'
        ],
        temperature: 0.7
    }, openai);

    const developerAgent = new Agent({
            name: 'Bob',
            goal: 'Perform code writing tasks, generate code examples, and save files',
            expectedOutput: 'Confirmation that the code snippet was saved to a file',
            model: baseModel,
            capabilities: [
                'coding',
                'file_management',
                'documentation'
            ],
            temperature: 0.2,
            systemPrompt: dedent`
            You are Bob, an AI developer assistant focused on writing clean, efficient code.
            You always provide well-commented code with proper error handling.
            When asked to save code, you use the FileWrite tool.`
            },
        openai, [fileWriteTool]);

    const synthesisAgent = new Agent({
        name: 'Charlie',
        goal: 'Synthesize information, create cohesive reports, and summarize overall findings',
        expectedOutput: 'Structured report with sections and summaries',
        model: baseModel,
        capabilities: [
            'synthesis',
            'report_writing',
            'summarization',
            'file_management'
        ],
        temperature: 0.5
    }, openai, [fileWriteTool]);

    // Add agents to crew
    crew.addAgent(researchAgent);
    crew.addAgent(developerAgent);
    crew.addAgent(synthesisAgent);

    // Define tasks
    crew.addTask('Research recent advancements in AI and summarize them in 3 bullet points');
    crew.addTask('Analyze potential cybersecurity implications of recent AI advancements');
    crew.addTask('Create a code example in Python that demonstrates how to use OpenAI\'s API. Save this example to a file "openai_example.py"');
    crew.addTask('Synthesize the research and analysis into a coherent overview');

    try
    {
        // Execute tasks
        logger.info('Executing tasks...');
        const results = await crew.executeAllTasks();

        // Log results
        logger.info('All tasks completed. Results:', Object.keys(results).length);

        // Generate final summary
        logger.info('Generating comprehensive report...');
        const summary = await crew.achieveCrewGoal();

        // Save final report
        await fileWriteTool.use({
            filename: 'final_report.md',
            content: summary
        });

        logger.info('Mission completed successfully! Final report saved to "final_report.md"');
    }
    catch (error)
    {
        logger.error('Mission failed:', error);
        process.exit(1);
    }
}

// Run the application
main().catch(error =>
{
    logger.fatal('Unhandled error:', error);
    process.exit(1);
});