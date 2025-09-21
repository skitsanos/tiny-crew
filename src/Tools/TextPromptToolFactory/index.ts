import type OpenAI from 'openai';
import Logger from '@/utils/logger.ts';
import TextPromptTool from '@/Tools/TextPromptTool';

/**
 * Factory class for creating common text processing tools
 */
export class TextPromptToolFactory
{
    private readonly client: OpenAI;
    private readonly logger: Logger;
    private readonly defaultModel: string;

    constructor(client: OpenAI, options: { logger?: Logger; defaultModel?: string } = {})
    {
        this.client = client;
        this.logger = options.logger || new Logger('TextPromptToolFactory');
        this.defaultModel = options.defaultModel || 'gpt-4o';
    }

    /**
     * Create a text summarization tool
     */
    createSummarizer(options: {
        name?: string;
        description?: string;
        wordCount?: number;
        bullets?: boolean;
        model?: string;
        temperature?: number;
    } = {}): TextPromptTool
    {
        const {
            name = 'TextSummarizer',
            description = 'Summarize text into a concise format',
            wordCount = 150,
            bullets = false,
            model = this.defaultModel,
            temperature = 0.3
        } = options;

        const outputFormat = bullets ? 'bullet points' : 'paragraphs';

        return new TextPromptTool(
            {
                name,
                description,
                model,
                temperature,
                promptTemplate: `Summarize the following text in approximately ${wordCount} words using ${outputFormat}. 
                
Text to summarize:
{text}

{options.instructions}`,
                systemPrompt: `You are an expert at creating clear, accurate summaries that capture the key points of text while maintaining the original meaning and tone.`
            },
            this.client,
            this.logger.child(name)
        );
    }

    /**
     * Create a text translation tool
     */
    createTranslator(options: {
        name?: string;
        description?: string;
        defaultTargetLanguage?: string;
        preserveFormatting?: boolean;
        model?: string;
        temperature?: number;
    } = {}): TextPromptTool
    {
        const {
            name = 'TextTranslator',
            description = 'Translate text between languages',
            defaultTargetLanguage = 'English',
            preserveFormatting = true,
            model = this.defaultModel,
            temperature = 0.3
        } = options;

        const formattingInstruction = preserveFormatting ?
                                      'Preserve the original formatting including paragraphs, bullet points, and emphasis.' :
                                      'Focus on translation quality over preserving original formatting.';

        return new TextPromptTool(
            {
                name,
                description,
                model,
                temperature,
                promptTemplate: `# TRANSLATION TASK
                
IMPORTANT: You MUST translate the text below into {targetLanguage|${defaultTargetLanguage}}. Return ONLY the translated text with no other content.

${formattingInstruction}

## Original text:
{text}

## TRANSLATE TO: {targetLanguage|${defaultTargetLanguage}}

{options.additionalInstructions}`,
                systemPrompt: `You are a professional translator specialized in accurate translations between languages. 
Your task is to translate content from the source language to the target language.
- You MUST return ONLY the translated text.
- You MUST NOT include any explanations or notes.
- You MUST NOT retain any text in the original language.
- You MUST translate ALL of the provided content.`
            },
            this.client,
            this.logger.child(name)
        );
    }

    /**
     * Create a sentiment analysis tool
     */
    createSentimentAnalyzer(options: {
        name?: string;
        description?: string;
        format?: 'score' | 'detailed' | 'simple';
        model?: string;
        temperature?: number;
    } = {}): TextPromptTool
    {
        const {
            name = 'SentimentAnalyzer',
            description = 'Analyze the sentiment of text',
            format = 'detailed',
            model = this.defaultModel,
            temperature = 0.1 // Lower temperature for more consistent analysis
        } = options;

        let promptTemplate: string;
        let systemPrompt: string;

        switch (format)
        {
            case 'score':
                promptTemplate = `Analyze the sentiment of the following text and provide a score from -10 (extremely negative) to +10 (extremely positive). Return only the numerical score without any additional explanation.
                
Text to analyze:
{text}`;
                systemPrompt = `You are a precise sentiment analysis tool that accurately measures emotional tone. You always respond with only a single number between -10 and +10.`;
                break;

            case 'simple':
                promptTemplate = `Analyze the sentiment of the following text and classify it as POSITIVE, NEGATIVE, or NEUTRAL. Return only the classification without any additional explanation.
                
Text to analyze:
{text}`;
                systemPrompt = `You are a precise sentiment analysis tool that accurately classifies emotional tone. You always respond with only POSITIVE, NEGATIVE, or NEUTRAL.`;
                break;

            case 'detailed':
            default:
                promptTemplate = `Analyze the sentiment of the following text. Provide:
1. Overall sentiment (positive/negative/neutral)
2. Sentiment strength (1-5 scale)
3. Key emotional tones detected
4. Brief explanation of your analysis
                
Text to analyze:
{text}

{options.additionalInstructions}`;
                systemPrompt = `You are an expert at detecting emotional tones, sentiment, and nuanced feelings in text. Your analysis is accurate, nuanced, and insightful.`;
                break;
        }

        return new TextPromptTool(
            {
                name,
                description,
                model,
                temperature,
                promptTemplate,
                systemPrompt
            },
            this.client,
            this.logger.child(name)
        );
    }

    /**
     * Create a text extraction tool
     */
    createExtractor(options: {
        name?: string;
        description?: string;
        extractionType?: 'entities' | 'keywords' | 'custom';
        customInstructions?: string;
        outputFormat?: 'json' | 'list' | 'text';
        model?: string;
        temperature?: number;
    } = {}): TextPromptTool
    {
        const {
            name = 'TextExtractor',
            description = 'Extract specific information from text',
            extractionType = 'entities',
            customInstructions = '',
            outputFormat = 'json',
            model = this.defaultModel,
            temperature = 0.2
        } = options;

        let extractionInstructions = '';
        let formatInstructions = '';

        // Set extraction instructions based on type
        switch (extractionType)
        {
            case 'entities':
                extractionInstructions = 'Extract all named entities (people, organizations, locations, dates, etc.)';
                break;
            case 'keywords':
                extractionInstructions = 'Extract the most important keywords and phrases that represent the main topics';
                break;
            case 'custom':
                extractionInstructions = customInstructions;
                break;
        }

        // Set format instructions
        switch (outputFormat)
        {
            case 'json':
                formatInstructions = 'Format your response as a JSON object with appropriate categories.';
                break;
            case 'list':
                formatInstructions = 'Format your response as a simple bulleted list.';
                break;
            case 'text':
                formatInstructions = 'Format your response as plain text with clear structure.';
                break;
        }

        return new TextPromptTool(
            {
                name,
                description,
                model,
                temperature,
                promptTemplate: `${extractionInstructions} from the following text. ${formatInstructions}
                
Text to process:
{text}

{options.specificInstructions}`,
                systemPrompt: `You are an expert at analyzing text and precisely extracting relevant information according to instructions.`
            },
            this.client,
            this.logger.child(name)
        );
    }

    /**
     * Create a custom text prompt tool with a defined template
     */
    createCustomTool(config: {
        name: string;
        description: string;
        promptTemplate: string;
        systemPrompt?: string;
        model?: string;
        temperature?: number;
        maxTokens?: number;
    }): TextPromptTool
    {
        return new TextPromptTool(
            {
                ...config,
                model: config.model || this.defaultModel
            },
            this.client,
            this.logger.child(config.name)
        );
    }
}

export default TextPromptToolFactory;