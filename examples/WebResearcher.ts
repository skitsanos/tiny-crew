import Crew from '@/Crew';
import Agent from '@/Agent';
import OpenAI from 'openai';
import Logger from '@/utils/logger';
import {WebScrapeTool} from '@/Tools/WebScrapeTool';
import {FileWriteTool} from '@/Tools/FileWriteTool';
import dedent from 'dedent';

const logger = new Logger('WebScrapeExample', {colorize: true});

async function runWebScrapeExample()
{
    logger.info('Starting web scraping mission');

    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
    {
        logger.fatal('OPENAI_API_KEY environment variable not set');
        process.exit(1);
    }

    const openai = new OpenAI({apiKey});
    const baseModel = process.env.LLM_MODEL || 'gpt-4o';

    // Initialize tools
    const webScrapeTool = new WebScrapeTool({
        allowedDomains: [
            'wikipedia.org',
            'github.com',
            'arxiv.org',
            'nytimes.com',
            'bbc.com',
            'theguardian.com'
        ],
        maxResponseSize: 2 * 1024 * 1024, // 2MB limit
        logger: new Logger('WebScrapeTool', {level: 'DEBUG'})
    });

    const fileWriteTool = new FileWriteTool({
        basePath: './output/web-scrape',
        allowedExtensions: [
            '.txt',
            '.md',
            '.json'
        ],
        logger: new Logger('FileWriteTool')
    });

    // Create a crew with a specific goal
    const crew = new Crew(
        {
            goal: 'Research, analyze, and summarize information about recent AI advancements',
            model: baseModel,
            temperature: 0.5
        },
        openai
    );

    // Create specialized agents
    const researchAgent = new Agent({
        name: 'Researcher',
        goal: 'Gather relevant information from websites efficiently and accurately',
        expectedOutput: 'Structured information extracts from web sources',
        model: baseModel,
        capabilities: [
            'web_research',
            'information_extraction',
            'critical_evaluation'
        ],
        temperature: 0.4,
        systemPrompt: dedent`
            You are a skilled research assistant specialized in extracting relevant information from web sources.
            Your task is to gather facts, key points, and insights from websites related to your assigned topics.
            Always cite your sources and organize the information in a clear, structured format.
            Prioritize authoritative sources and factual information over opinions.
            When using the WebScrape tool, select appropriate selectors to target the most relevant content.
        `
    }, openai, [webScrapeTool]);

    const analyzerAgent = new Agent({
        name: 'Analyzer',
        goal: 'Analyze and synthesize information, identifying patterns, trends, and key insights',
        expectedOutput: 'Analytical summary with key insights and interpretations',
        model: baseModel,
        capabilities: [
            'data_analysis',
            'pattern_recognition',
            'critical_thinking',
            'insight_generation'
        ],
        temperature: 0.5,
        systemPrompt: dedent`
            You are an analytical expert who excels at synthesizing information from different sources.
            Your task is to identify key patterns, trends, and insights from the research gathered.
            Evaluate the quality and reliability of the information, identifying any gaps or inconsistencies.
            Create connections between different pieces of information and extract meaningful implications.
            Organize your analysis in a structured, logical format that highlights the most important findings.
        `
    }, openai);

    const writerAgent = new Agent({
        name: 'Writer',
        goal: 'Create comprehensive, well-structured reports based on research and analysis',
        expectedOutput: 'Polished report documents ready for distribution',
        model: baseModel,
        capabilities: [
            'content_creation',
            'summarization',
            'narrative_development',
            'file_management'
        ],
        temperature: 0.6,
        systemPrompt: dedent`
            You are an expert writer specializing in creating clear, engaging reports from complex information.
            Your task is to transform research and analysis into well-structured documents with a coherent narrative.
            Organize content logically with clear sections, summaries, and key takeaways.
            Balance technical accuracy with accessibility for the intended audience.
            Save your research into "web_research_report.md" file using the FileWrite tool.
        `
    }, openai, [fileWriteTool]);

    // Add the agents to the crew
    crew.addAgent(researchAgent);
    crew.addAgent(analyzerAgent);
    crew.addAgent(writerAgent);

    try
    {
        // Define research topic
        const topic = process.env.RESEARCH_TOPIC || 'recent advancements in generative AI';

        // Define tasks
        logger.info(`Starting research on: ${topic}`);

        // Research tasks
        crew.addTask(`Search for and extract information about ${topic} from Wikipedia. Use the WebScrape tool with appropriate selectors to get relevant content.`);

        crew.addTask(`Find recent news or articles about ${topic} from trusted news sources. Extract headlines, publication dates, and key points using the WebScrape tool.`);

        crew.addTask(`Look for technical information about ${topic} from academic or professional sources. Focus on extracting methodology details, technical specifications, or research findings.`);

        // Analysis task
        crew.addTask(`Analyze all the gathered information about ${topic}. Identify the most significant developments, common themes, and potential future directions. Compare and contrast different perspectives or approaches mentioned in the sources.`);

        // Report creation task
        crew.addTask(`Create a comprehensive report on ${topic} based on the research and analysis. The report should include an executive summary, introduction, main findings, discussion of implications, and conclusion. Save the report as a markdown file named "${topic.replace(/\s+/g, '_')}_report.md".`);

        // Execute tasks
        logger.info('Executing tasks...');
        const results = await crew.executeAllTasks();

        logger.info('All tasks completed. Generating final summary...');

        // Generate final summary
        const summary = await crew.achieveCrewGoal();

        // Display summary
        logger.info('Research mission completed successfully!');
        console.log('\n=== Summary ===\n');
        console.log(summary);

        return summary;
    }
    catch (error)
    {
        logger.error('An error occurred during the web scraping mission:', error);
        throw error;
    }
}

// Run the example if this script is executed directly
if (require.main === module)
{
    runWebScrapeExample()
        .then(() =>
        {
            logger.info('Web scraping example completed successfully');
            process.exit(0);
        })
        .catch(error =>
        {
            logger.error('Web scraping example failed:', error);
            process.exit(1);
        });
}

export default runWebScrapeExample;