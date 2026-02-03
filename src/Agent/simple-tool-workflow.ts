/**
 * Simplified tool calling workflow - single iteration approach
 */

import type { ModelRouter } from '@tinycrew/ModelRouter';
import type Logger from '@tinycrew/utils/logger';
import { withRetry } from '@tinycrew/utils/retry';
import type { LlmConfig, ModelPurpose, Tool } from '@tinycrew/utils/types';
import type OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

export class SimpleToolWorkflow {
    constructor(
        private tools: Map<string, Tool>,
        private client: OpenAI,
        private logger: Logger,
        private llmConfig: LlmConfig,
        private modelRouter?: ModelRouter,
    ) {}

    /**
     * Get the model for a specific purpose
     */
    private getModelForPurpose(purpose: ModelPurpose): string {
        if (this.modelRouter) {
            return this.modelRouter.getModel(purpose);
        }
        return this.llmConfig.model;
    }

    /**
     * Simple tool execution: One response -> Execute tools -> One final response
     */
    async executeTask(
        conversation: ResponseInputItem[],
    ): Promise<{ text: string; toolsUsed: string[] }> {
        const toolsUsed: string[] = [];

        // Step 1: Get initial response with tool calls
        const initialResponse = await withRetry(
            () =>
                this.client.responses.create({
                    model: this.getModelForPurpose('task_execution'),
                    input: conversation,
                    ...(this.llmConfig.temperature !== undefined
                        ? { temperature: this.llmConfig.temperature }
                        : {}),
                    ...(this.llmConfig.maxTokens !== undefined
                        ? { max_output_tokens: this.llmConfig.maxTokens }
                        : {}),
                    tools:
                        this.tools.size > 0
                            ? this.buildToolDefinitions()
                            : undefined,
                    tool_choice: this.tools.size > 0 ? 'auto' : undefined,
                }),
            this.logger,
            'simple-workflow:initial',
        );

        const outputItems = initialResponse.output ?? [];

        // Extract tool calls from response (function_call items and message-embedded)
        const toolCalls = this.extractToolCalls(outputItems);

        // Step 2: If no tools called, return the response
        if (toolCalls.length === 0) {
            return {
                text: this.extractTextFromResponse(initialResponse),
                toolsUsed,
            };
        }

        // Step 3: Execute all tool calls
        const toolOutputs: ResponseInputItem[] = [];

        for (const call of toolCalls) {
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
                    output:
                        typeof result === 'string'
                            ? result
                            : JSON.stringify(result),
                } as ResponseInputItem);
            } catch (error) {
                this.logger.error(`Tool execution failed: ${call.name}`, error);
                toolOutputs.push({
                    type: 'function_call_output',
                    call_id: call.call_id,
                    output: JSON.stringify({ error: (error as Error).message }),
                } as ResponseInputItem);
            }
        }

        // Step 4: Use previous_response_id to maintain structured context.
        // This preserves the full function_call items (name, args, call_id) from the
        // initial response, allowing the model to deterministically align outputs to tools.
        // The input only needs the function_call_output items - the API handles context.
        const finalResponse = await withRetry(
            () =>
                this.client.responses.create({
                    model: this.getModelForPurpose('tool_synthesis'),
                    previous_response_id: initialResponse.id, // Preserves structured tool-call context
                    input: toolOutputs, // Only the function_call_output items
                    ...(this.llmConfig.temperature !== undefined
                        ? { temperature: this.llmConfig.temperature }
                        : {}),
                    ...(this.llmConfig.maxTokens !== undefined
                        ? { max_output_tokens: this.llmConfig.maxTokens }
                        : {}),
                }),
            this.logger,
            'simple-workflow:follow-up',
        );

        return {
            text: this.extractTextFromResponse(finalResponse),
            toolsUsed,
        };
    }

    /**
     * Extract tool calls from response output items.
     * Handles both function_call items and message-embedded tool calls.
     */
    private extractToolCalls(
        outputItems: any[],
    ): Array<{ call_id: string; name: string; arguments: string }> {
        const toolCalls: Array<{
            call_id: string;
            name: string;
            arguments: string;
        }> = [];

        for (const item of outputItems) {
            // Handle function_call items (primary Responses API format)
            if (item.type === 'function_call') {
                toolCalls.push({
                    call_id: item.call_id,
                    name: item.name,
                    arguments: item.arguments,
                });
            }
            // Handle message-embedded tool calls (for compatibility)
            else if (item.type === 'message' && item.content) {
                for (const content of item.content) {
                    if (
                        content.type === 'tool_use' ||
                        content.type === 'function_call'
                    ) {
                        toolCalls.push({
                            call_id: content.id || content.call_id,
                            name: content.name,
                            arguments:
                                typeof content.input === 'string'
                                    ? content.input
                                    : JSON.stringify(
                                          content.input ||
                                              content.arguments ||
                                              {},
                                      ),
                        });
                    }
                }
            }
        }

        return toolCalls;
    }

    private buildToolDefinitions() {
        return Array.from(this.tools.values()).map((tool) => ({
            type: 'function' as const,
            name: tool.schema.name,
            description: tool.schema.description,
            parameters: {
                ...tool.schema.parameters,
                additionalProperties: false,
            },
            strict: true,
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
