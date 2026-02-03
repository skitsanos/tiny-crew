/**
 * PersistentMemory Example
 *
 * Demonstrates the new Memory system features:
 * - Using JSONFileBackend for persistent memory across runs
 * - Loading/saving memory explicitly
 * - Querying memory by agent, tags, and keywords
 * - Building memory context for prompts
 * - Viewing memory statistics
 *
 * Run multiple times to see how memory persists between executions.
 */

import path from 'node:path';
import Agent from '@tinycrew/Agent';
import Crew, { type CrewOptions } from '@tinycrew/Crew';
import { JSONFileBackend, MemoryEvent } from '@tinycrew/Memory';
import Logger from '@tinycrew/utils/logger';
import dedent from 'dedent';
import OpenAI from 'openai';

const logger = new Logger('PersistentMemoryExample', {
    level: 'DEBUG',
    colorize: true,
});

async function runPersistentMemoryExample() {
    logger.info('Starting Persistent Memory Example');

    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        logger.fatal('OPENAI_API_KEY environment variable not set');
        process.exit(1);
    }

    const openai = new OpenAI({ apiKey });
    const baseModel = process.env.DEFAULT_MODEL || 'gpt-4o-mini';

    // Configure JSON file backend for persistent memory
    const memoryBackend = new JSONFileBackend({
        basePath: path.join(process.cwd(), 'data', 'memory'),
        prettyPrint: true, // Human-readable JSON files
        createDir: true,
    });

    // Crew options with custom memory backend
    const crewOptions: CrewOptions = {
        memoryBackend,
        memoryConfig: {
            maxItems: 50,
            maxTotalTokens: 50000,
            autoEvict: true,
        },
    };

    // Create the crew with persistent memory
    const crew = new Crew(
        {
            goal: 'Build a knowledge base about technology topics through research and analysis',
            model: baseModel,
            temperature: 0.5,
        },
        openai,
        [], // empty chat history
        crewOptions,
    );

    // Listen for memory events
    const memoryStore = crew.getMemoryStore();

    memoryStore.on(MemoryEvent.ITEM_SET, (payload) => {
        logger.debug(`Memory item stored: ${payload.key}`);
    });

    memoryStore.on(MemoryEvent.ITEMS_EVICTED, (payload) => {
        logger.warn(
            `Evicted ${payload.count} memory items (reason: ${payload.reason})`,
        );
    });

    // Create specialized agents
    const researchAgent = new Agent(
        {
            name: 'Researcher',
            goal: 'Research and summarize technical topics accurately',
            expectedOutput: 'Concise technical summaries with key facts',
            model: baseModel,
            capabilities: ['research', 'summarization', 'technical_writing'],
            temperature: 0.4,
            systemPrompt: dedent`
            You are a technical researcher who provides accurate, concise summaries of technology topics.
            Focus on key facts, recent developments, and practical applications.
            Keep responses under 300 words.`,
        },
        openai,
    );

    const analystAgent = new Agent(
        {
            name: 'Analyst',
            goal: 'Analyze trends and provide insights from research data',
            expectedOutput: 'Analytical insights with supporting reasoning',
            model: baseModel,
            capabilities: [
                'analysis',
                'trend_identification',
                'insight_generation',
            ],
            temperature: 0.5,
            systemPrompt: dedent`
            You are a technology analyst who identifies patterns and provides actionable insights.
            Base your analysis on available data and clearly state your reasoning.
            Highlight opportunities and potential concerns.`,
        },
        openai,
    );

    crew.addAgent(researchAgent);
    crew.addAgent(analystAgent);

    try {
        // Load any existing memory from previous runs
        logger.info('Loading memory from previous runs...');
        await crew.loadMemory();

        // Check existing memory stats
        const initialStats = await crew.getMemoryStats();
        logger.info('Memory stats at startup:', initialStats);

        if (initialStats.itemCount > 0) {
            logger.info(
                `Found ${initialStats.itemCount} items from previous runs`,
            );

            // Query memory for previous research by the Researcher agent
            const previousResearch = await memoryStore.query(crew.getId(), {
                agent: 'Researcher',
                maxItems: 5,
                sortBy: 'recency',
            });

            if (previousResearch.length > 0) {
                logger.info('Previous research topics:');
                for (const item of previousResearch) {
                    logger.info(
                        `  - ${item.task.slice(0, 60)}... (${new Date(item.createdAt).toLocaleDateString()})`,
                    );
                }
            }

            // Build context from existing memory for the current session
            const memoryContext = await crew.buildMemoryContext({
                maxTokens: 2000,
                maxItems: 10,
            });

            if (memoryContext) {
                logger.debug('Built memory context for prompts:', {
                    length: memoryContext.length,
                    preview: `${memoryContext.slice(0, 200)}...`,
                });
            }
        }

        // Define new research topics (different each run for variety)
        const topics = [
            'quantum computing applications in cryptography',
            'large language models and their enterprise applications',
            'edge computing trends in IoT',
            'sustainable technology in data centers',
            'AI-powered cybersecurity solutions',
        ];

        // Pick a random topic or use env variable
        const topic =
            process.env.RESEARCH_TOPIC ||
            topics[Math.floor(Math.random() * topics.length)];
        logger.info(`Research topic for this run: ${topic}`);

        // Add tasks
        crew.addTask(
            `Research and summarize the current state of ${topic}. Include recent developments and key players in this space.`,
        );
        crew.addTask(
            `Analyze the market trends and future outlook for ${topic}. Identify opportunities and challenges.`,
        );

        // Execute tasks
        logger.info('Executing research tasks...');
        const results = await crew.executeAllTasks();

        logger.info('Tasks completed:', Object.keys(results).length);

        // Save memory explicitly (also happens automatically on each task)
        await crew.saveMemory();
        logger.info('Memory saved to disk');

        // Show final memory statistics
        const finalStats = await crew.getMemoryStats();
        logger.info('Final memory stats:', finalStats);

        // Query memory by keywords
        const aiRelatedMemory = await memoryStore.query(crew.getId(), {
            keywords: ['AI', 'machine learning', 'artificial intelligence'],
            maxItems: 5,
        });

        if (aiRelatedMemory.length > 0) {
            logger.info(
                `Found ${aiRelatedMemory.length} AI-related memory items`,
            );
        }

        // Generate final summary using memory context
        const summary = await crew.provideFinalResponse(dedent`
            Based on all the research conducted (including any previous sessions stored in memory),
            provide a brief executive summary of our knowledge base on technology topics.
            Highlight the most important findings and any connections between different topics.`);

        console.log('\n=== Executive Summary ===\n');
        console.log(summary);
        console.log('\n========================\n');

        // Clean up
        await crew.closeMemory();
        logger.info(
            'Memory store closed. Run this example again to see persistent memory in action!',
        );

        return summary;
    } catch (error) {
        logger.error('An error occurred:', error);
        await crew.closeMemory();
        throw error;
    }
}

// Run the example
runPersistentMemoryExample()
    .then(() => {
        logger.info('Example completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('Example failed:', error);
        process.exit(1);
    });

export default runPersistentMemoryExample;
