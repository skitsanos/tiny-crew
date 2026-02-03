import TextPromptToolFactory from '@tinycrew/Tools/TextPromptToolFactory';
import Logger from '@tinycrew/utils/logger';
import OpenAI from 'openai';

const logger = new Logger('TextToolsTest', { colorize: true });

async function testTextTools() {
    // Initialize OpenAI client
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    // Create a factory instance
    const factory = new TextPromptToolFactory(openai);

    // Sample text for testing
    const sampleText = `
Climate change is one of the most pressing challenges of our time. Rising global temperatures have led to more frequent and severe weather events, including hurricanes, floods, and wildfires. Sea levels are rising, threatening coastal communities worldwide. Despite overwhelming scientific consensus on the human causes of climate change, political and economic barriers have slowed meaningful action. Addressing this crisis requires coordinated global efforts, technological innovation, and significant changes to how we produce and consume energy.
    `;

    const translator = factory.createTranslator();

    logger.info('Testing translator...');
    try {
        // Log the exact parameters being sent to the tool
        logger.debug('Translation parameters:', {
            targetLanguage: 'French',
            textLength: sampleText.length,
            additionalInstructions:
                'Use simple language appropriate for a general audience.',
        });

        const translation = await translator.use({
            text: sampleText,
            targetLanguage: 'French',
            options: {
                additionalInstructions:
                    'Use simple language appropriate for a general audience.',
            },
        });

        console.log('\n--- FRENCH TRANSLATION ---\n');
        console.log(translation);

        // Verification check
        logger.info(
            `Translation success. Result contains French words: ${[
                'est',
                'changement',
                'climatique',
                'notre',
                'temps',
            ].some((word) => translation.toLowerCase().includes(word))}`,
        );
    } catch (error) {
        logger.error('Translation failed:', error);
    }
}

// Run the tests
testTextTools().catch((error) => {
    logger.error('Tests failed:', error);
    process.exit(1);
});
