import type OpenAI from 'openai';
import type { Tool, ToolSchema } from '@/utils/types.ts';
import Logger from '@/utils/logger.ts';
import type { Response } from 'openai/resources/responses/responses';
import { withRetry } from '@/utils/retry.ts';

interface TextPromptConfig {
    name: string;
    description: string;
    promptTemplate: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

interface TextPromptArgs {
    text: string;
    [key: string]: any; // Additional parameters that can be used in the prompt template
}

/**
 * TextPromptTool - A configurable tool for text transformations using LLM prompts
 * Similar to Semantic Kernel's prompt functions
 */
export class TextPromptTool implements Tool {
    public readonly name: string;
    public readonly description: string;
    public readonly schema: ToolSchema;
    private readonly promptTemplate: string;
    private readonly systemPrompt: string;
    private readonly model: string;
    private readonly temperature: number;
    private readonly maxTokens: number;
    private readonly logger: Logger;
    private readonly client: OpenAI;

    constructor(config: TextPromptConfig, client: OpenAI, logger?: Logger) {
        this.name = config.name;
        this.description = config.description;
        this.promptTemplate = config.promptTemplate;
        this.systemPrompt = config.systemPrompt || 'You are a helpful assistant that processes text according to instructions.';
        this.model = config.model || 'gpt-4o';
        this.temperature = config.temperature || 0.3;
        this.maxTokens = config.maxTokens || 1024;
        this.client = client;
        this.logger = logger || new Logger(`TextPromptTool-${this.name}`);

        // Initialize schema after the name and description are set
        this.schema = {
            name: this.name,
            description: this.description,
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'The input text to process'
                    },
                    // Note: Additional parameters defined based on the prompt template
                    // will be accessible but aren't explicitly defined in the schema
                    // This keeps the tool flexible
                    options: {
                        type: 'object',
                        description: 'Additional options for text processing'
                    }
                },
                required: ['text']
            }
        };
    }

    /**
     * Validates the input arguments
     */
    public validateInput(args: TextPromptArgs): boolean {
        if (!args.text || typeof args.text !== 'string') {
            this.logger.warn('Invalid text input provided');
            return false;
        }
        return true;
    }

    /**
     * Returns the capabilities of this tool
     */
    public getCapabilities(): string[] {
        return ['text_processing', 'llm_prompt_execution', this.name.toLowerCase()];
    }

    /**
     * Populate the template with values from args
     */
    private populateTemplate(template: string, args: TextPromptArgs): string {
        return template.replace(/\{(\w+)(?:\|([^}]+))?\}/g, (match, key, defaultValue) => {
            // First check if the key exists directly in args
            if (key in args) {
                return String(args[key]);
            }

            // Next, check if it's nested in options
            if (args.options && key in args.options) {
                return String(args.options[key]);
            }

            // If key is "options.X", try to get from args.options.X
            if (key.startsWith('options.') && args.options) {
                const optionKey = key.split('.')[1];
                if (optionKey in args.options) {
                    return String(args.options[optionKey]);
                }
            }

            // Finally use the default value if provided
            if (defaultValue !== undefined) {
                return defaultValue;
            }

            // Keep the placeholder if no value is found
            return match;
        });
    }

    /**
     * Process text using the configured prompt template
     */
    public async use(args: TextPromptArgs): Promise<string> {
        if (!this.validateInput(args)) {
            throw new Error(`Invalid arguments for ${this.name}`);
        }

        try {
            this.logger.debug(`Processing text with ${this.name}`, {
                textLength: args.text.length,
                args: Object.keys(args).filter(k => k !== 'text')
            });

            // Populate the prompt template with args
            const populatedPrompt = this.populateTemplate(this.promptTemplate, args);

            // Make the LLM request
            const response = await withRetry(
                () => this.client.responses.create({
                    model: this.model,
                    input: [
                        { role: 'system', content: this.systemPrompt },
                        { role: 'user', content: populatedPrompt }
                    ],
                    temperature: this.temperature,
                    ...(this.maxTokens ? { max_output_tokens: this.maxTokens } : {})
                }),
                this.logger,
                `text_prompt_tool:${this.name}`
            );

            const result = this.extractTextFromResponse(response);
            if (!result) {
                throw new Error('Empty response from LLM');
            }

            this.logger.debug(`Successfully processed text with ${this.name}`, {
                inputLength: args.text.length,
                outputLength: result.length
            });

            return result;
        } catch (error) {
            this.logger.error(`Error processing text with ${this.name}:`, error);
            throw error;
        }
    }

    private extractTextFromResponse(response: Response): string {
        if (response.output_text && response.output_text.trim().length > 0) {
            return response.output_text;
        }

        const texts: string[] = [];
        for (const item of response.output ?? []) {
            if (item.type === 'message') {
                for (const content of item.content) {
                    if (content.type === 'output_text') {
                        texts.push(content.text);
                    }
                }
            }
        }

        return texts.join('\n').trim();
    }
}

export default TextPromptTool;
