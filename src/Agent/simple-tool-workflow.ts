/**
 * Simplified tool calling workflow - single iteration approach
 */
import type OpenAI from 'openai';
import type { ResponseInputItem, ResponseFunctionToolCall } from 'openai/resources/responses/responses';
import type { Tool } from '@/utils/types';

export class SimpleToolWorkflow {
    constructor(
        private tools: Map<string, Tool>,
        private client: OpenAI,
        private logger: any,
        private llmConfig: any
    ) {}

    /**
     * Simple tool execution: One response -> Execute tools -> One final response
     */
    async executeTask(conversation: ResponseInputItem[]): Promise<{ text: string; toolsUsed: string[] }> {
        const toolsUsed: string[] = [];

        // Step 1: Get initial response with tool calls
        const initialResponse = await this.client.responses.create({
            model: this.llmConfig.model,
            input: conversation,
            temperature: this.llmConfig.temperature,
            max_output_tokens: this.llmConfig.maxTokens,
            tools: this.tools.size > 0 ? this.buildToolDefinitions() : undefined,
            tool_choice: this.tools.size > 0 ? 'auto' : undefined
        });

        const outputItems = initialResponse.output ?? [];
        conversation.push(...outputItems);

        const functionCalls = outputItems.filter((item): item is ResponseFunctionToolCall =>
            item.type === 'function_call'
        );

        // Step 2: If no tools called, return the response
        if (functionCalls.length === 0) {
            return {
                text: this.extractTextFromResponse(initialResponse),
                toolsUsed
            };
        }

        // Step 3: Execute all tool calls once
        const toolOutputs: any[] = [];

        for (const call of functionCalls) {
            const args = this.safeParseJson(call.arguments);
            toolsUsed.push(call.name);

            try {
                const tool = this.tools.get(call.name);
                if (!tool) {
                    throw new Error(`Tool ${call.name} not found`);
                }

                this.logger.info(`Executing tool: ${call.name}`, { args });
                const result = await tool.use(args);

                toolOutputs.push({
                    type: 'function_call_output',
                    call_id: call.call_id,
                    output: typeof result === 'string' ? result : JSON.stringify(result)
                });

            } catch (error) {
                this.logger.error(`Tool execution failed: ${call.name}`, error);
                toolOutputs.push({
                    type: 'function_call_output',
                    call_id: call.call_id,
                    output: JSON.stringify({ error: (error as Error).message })
                });
            }
        }

        // Step 4: Add tool outputs and get final response
        conversation.push(...toolOutputs);

        const finalResponse = await this.client.responses.create({
            model: this.llmConfig.model,
            input: conversation,
            temperature: this.llmConfig.temperature,
            max_output_tokens: this.llmConfig.maxTokens
        });

        return {
            text: this.extractTextFromResponse(finalResponse),
            toolsUsed
        };
    }

    private buildToolDefinitions() {
        return Array.from(this.tools.values()).map(tool => ({
            name: tool.schema.name,
            type: 'function' as const,
            function: tool.schema
        }));
    }

    private extractTextFromResponse(response: any): string {
        if (response.output_text?.trim()) {
            return response.output_text.trim();
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

    private safeParseJson(value: string | null | undefined): any {
        if (!value) return {};
        try {
            return JSON.parse(value);
        } catch {
            return {};
        }
    }
}