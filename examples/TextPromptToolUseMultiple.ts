import OpenAI from 'openai';
import Logger from '@/utils/logger.ts';
import TextPromptToolFactory from '@/Tools/TextPromptToolFactory';
import dedent from 'dedent';


const logger = new Logger('TextToolsTest', { colorize: true });

async function testTextTools() {
    // Initialize OpenAI client
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    // Create a factory instance
    const factory = new TextPromptToolFactory(openai);

    // Sample text for testing
    const sampleText = dedent`
    Climate change is one of the most pressing challenges of our time. \
    Rising global temperatures have led to more frequent and severe weather events, \
    including hurricanes, floods, and wildfires. Sea levels are rising, \
    threatening coastal communities worldwide. Despite overwhelming scientific \
    consensus on the human causes of climate change, political and economic \
    barriers have slowed meaningful action. Addressing this crisis requires \
    coordinated global efforts, technological innovation, and significant changes \
    to how we produce and consume energy.
    `;

    // Test 1: Basic summarization
    const summarizer = factory.createSummarizer({
        wordCount: 50
    });

    logger.info('Testing summarizer...');
    try {
        const summary = await summarizer.use({ text: sampleText });
        console.log('\n--- SUMMARY ---\n');
        console.log(summary);
    } catch (error) {
        logger.error('Summarization failed:', error);
    }

    // Test 2: Bullet point summarization with custom options
    const bulletSummarizer = factory.createSummarizer({
        name: 'BulletSummarizer',
        bullets: true,
        wordCount: 75
    });

    logger.info('Testing bullet point summarizer...');
    try {
        const bulletSummary = await bulletSummarizer.use({
            text: sampleText,
            options: {
                instructions: 'Focus on the challenges and solutions mentioned in the text.'
            }
        });
        console.log('\n--- BULLET SUMMARY ---\n');
        console.log(bulletSummary);
    } catch (error) {
        logger.error('Bullet summarization failed:', error);
    }

    // Test 3: Translation
    const translator = factory.createTranslator();

    logger.info('Testing translator...');
    try {
        const translation = await translator.use({
            text: sampleText,
            targetLanguage: 'French',
            options: {
                additionalInstructions: 'Use simple language appropriate for a general audience.'
            }
        });
        console.log('\n--- FRENCH TRANSLATION ---\n');
        console.log(translation);
    } catch (error) {
        logger.error('Translation failed:', error);
    }

    // Test 4: Sentiment analysis
    const sentimentAnalyzer = factory.createSentimentAnalyzer();

    logger.info('Testing sentiment analyzer...');
    try {
        const sentiment = await sentimentAnalyzer.use({ text: sampleText });
        console.log('\n--- SENTIMENT ANALYSIS ---\n');
        console.log(sentiment);
    } catch (error) {
        logger.error('Sentiment analysis failed:', error);
    }

    // Test 5: Entity extraction
    const entityExtractor = factory.createExtractor({
        extractionType: 'entities',
        outputFormat: 'json'
    });

    logger.info('Testing entity extractor...');
    try {
        const entities = await entityExtractor.use({ text: sampleText });
        console.log('\n--- ENTITY EXTRACTION ---\n');
        console.log(entities);
    } catch (error) {
        logger.error('Entity extraction failed:', error);
    }

    // Test 6: Custom tool - create a tool for explaining complex concepts
    const conceptExplainer = factory.createCustomTool({
        name: 'ConceptExplainer',
        description: 'Explain complex concepts in simple terms',
        promptTemplate: `
Explain the following {topic|concept} in simple terms that a {audience|general audience} would understand.
Use analogies and examples where helpful.

Text to explain:
{text}

Additional requirements:
{options.requirements}
        `,
        systemPrompt: 'You are an expert at explaining complex topics in accessible ways without sacrificing accuracy.',
        temperature: 0.5
    });

    logger.info('Testing concept explainer...');
    try {
        const explanation = await conceptExplainer.use({
            text: sampleText,
            topic: 'environmental issue',
            audience: '12-year-old student',
            options: {
                requirements: 'Include at least one analogy that would resonate with children.'
            }
        });
        console.log('\n--- SIMPLIFIED EXPLANATION ---\n');
        console.log(explanation);
    } catch (error) {
        logger.error('Concept explanation failed:', error);
    }
}

// Run the tests
testTextTools().catch(error => {
    logger.error('Tests failed:', error);
    process.exit(1);
});