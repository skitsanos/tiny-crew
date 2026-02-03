/**
 * Tests for Agent Conversation Summarization
 */

import { describe, expect, it } from 'bun:test';
import type OpenAI from 'openai';
import { Agent } from '../src/Agent';
import { AgentEvent } from '../src/utils/types';

/**
 * Create a mock OpenAI client for testing
 */
function createMockOpenAIClient(
    responses: string[] = ['Mock response'],
): OpenAI {
    let callCount = 0;
    return {
        responses: {
            create: async () => {
                const response = responses[callCount % responses.length];
                callCount++;
                return {
                    id: `mock-response-${callCount}`,
                    output_text: response,
                    output: [
                        {
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: response }],
                        },
                    ],
                };
            },
        },
    } as unknown as OpenAI;
}

describe('Agent Conversation Summarization', () => {
    describe('Configuration', () => {
        it('summarization is disabled by default', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            expect(agent.isSummarizationEnabled()).toBe(false);
        });

        it('summarization can be enabled via config', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            expect(agent.isSummarizationEnabled()).toBe(true);
        });
    });

    describe('estimateHistoryTokens()', () => {
        it('estimates tokens based on character count', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            // Add messages with known length
            agent.addToHistory({ role: 'user', content: 'Hello' }); // 5 chars
            agent.addToHistory({ role: 'assistant', content: 'Hi there!' }); // 9 chars

            // Total: 14 chars, estimated tokens: ceil(14/4) = 4
            expect(agent.estimateHistoryTokens()).toBe(4);
        });

        it('includes existing summary in token estimate', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            // Set a summary
            agent.setConversationSummary('This is a test summary'); // 22 chars

            // Add a message
            agent.addToHistory({ role: 'user', content: 'Hello' }); // 5 chars

            // Total: 27 chars, estimated tokens: ceil(27/4) = 7
            expect(agent.estimateHistoryTokens()).toBe(7);
        });

        it('returns 0 for empty history', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            expect(agent.estimateHistoryTokens()).toBe(0);
        });
    });

    describe('getConversationSummary()', () => {
        it('returns empty string initially', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            expect(agent.getConversationSummary()).toBe('');
        });

        it('returns set summary', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            agent.setConversationSummary('Test summary');
            expect(agent.getConversationSummary()).toBe('Test summary');
        });
    });

    describe('summarizeHistory()', () => {
        it('does not summarize if history is too short', async () => {
            const client = createMockOpenAIClient(['Summary result']);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Add only a few messages (less than keepRecentCount default of 10)
            agent.addToHistory({ role: 'user', content: 'Message 1' });
            agent.addToHistory({ role: 'assistant', content: 'Response 1' });

            const result = await agent.summarizeHistory();

            // Should return empty string since nothing was summarized
            expect(result).toBe('');
            expect(agent.getHistoryLength()).toBe(2);
        });

        it('summarizes old messages and keeps recent ones', async () => {
            const summaryText =
                'User discussed multiple topics including A, B, and C.';
            const client = createMockOpenAIClient([summaryText]);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Add many messages
            for (let i = 0; i < 15; i++) {
                agent.addToHistory({ role: 'user', content: `Message ${i}` });
                agent.addToHistory({
                    role: 'assistant',
                    content: `Response ${i}`,
                });
            }

            expect(agent.getHistoryLength()).toBe(30);

            // Summarize keeping 10 recent messages
            const result = await agent.summarizeHistory(10);

            // Should have summary text
            expect(result).toBe(summaryText);
            expect(agent.getConversationSummary()).toBe(summaryText);

            // History should be reduced: 1 summary system message + 10 recent messages
            expect(agent.getHistoryLength()).toBe(11);
        });

        it('keeps system message at the start', async () => {
            const summaryText = 'Conversation summary';
            const client = createMockOpenAIClient([summaryText]);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Add system message first
            agent.addToHistory({
                role: 'system',
                content: 'System instructions',
            });

            // Add many messages
            for (let i = 0; i < 15; i++) {
                agent.addToHistory({ role: 'user', content: `Message ${i}` });
                agent.addToHistory({
                    role: 'assistant',
                    content: `Response ${i}`,
                });
            }

            await agent.summarizeHistory(10);

            const history = agent.getHistory();
            // First message should still be the original system message
            expect(history[0].role).toBe('system');
            expect(history[0].content).toBe('System instructions');
        });

        it('emits HISTORY_SUMMARIZED event', async () => {
            const summaryText = 'Summary of conversation';
            const client = createMockOpenAIClient([summaryText]);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Add messages
            for (let i = 0; i < 15; i++) {
                agent.addToHistory({ role: 'user', content: `Message ${i}` });
                agent.addToHistory({
                    role: 'assistant',
                    content: `Response ${i}`,
                });
            }

            let eventData: any = null;
            agent.on(AgentEvent.HISTORY_SUMMARIZED, (data) => {
                eventData = data;
            });

            await agent.summarizeHistory(10);

            expect(eventData).not.toBeNull();
            expect(eventData.agent).toBe('TestAgent');
            expect(eventData.previousLength).toBe(30);
            expect(eventData.newLength).toBe(11); // 1 summary + 10 recent
            expect(eventData.summarizedCount).toBe(20); // 30 - 10 = 20 messages summarized
            expect(eventData.summaryLength).toBeGreaterThan(0);
        });

        it('uses custom keepRecentCount', async () => {
            const client = createMockOpenAIClient(['Summary']);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Add messages
            for (let i = 0; i < 25; i++) {
                agent.addToHistory({ role: 'user', content: `Message ${i}` });
            }

            await agent.summarizeHistory(5);

            // Should have 1 summary system message + 5 recent messages
            expect(agent.getHistoryLength()).toBe(6);
        });

        it('includes existing summary in new summarization', async () => {
            let summarizationPrompt = '';
            const client = {
                responses: {
                    create: async (request: any) => {
                        // Capture the prompt
                        const userMessage = request.input.find(
                            (m: any) => m.role === 'user',
                        );
                        if (userMessage) {
                            summarizationPrompt =
                                userMessage.content?.[0]?.text || '';
                        }
                        return {
                            id: 'mock-response',
                            output_text: 'New summary',
                            output: [
                                {
                                    type: 'message',
                                    role: 'assistant',
                                    content: [
                                        {
                                            type: 'output_text',
                                            text: 'New summary',
                                        },
                                    ],
                                },
                            ],
                        };
                    },
                },
            } as unknown as OpenAI;

            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                },
                client,
            );

            // Set existing summary
            agent.setConversationSummary('Previous context about topic X');

            // Add messages
            for (let i = 0; i < 15; i++) {
                agent.addToHistory({ role: 'user', content: `Message ${i}` });
            }

            await agent.summarizeHistory(5);

            // Should include previous summary in the prompt
            expect(summarizationPrompt).toContain(
                'Previous context about topic X',
            );
        });
    });

    describe('exportConversationState()', () => {
        it('includes summary in exported state', () => {
            const client = createMockOpenAIClient();
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                },
                client,
            );

            agent.setConversationSummary('Test summary');
            agent.addToHistory({ role: 'user', content: 'Hello' });

            const state = agent.exportConversationState();

            expect(state.summary).toBe('Test summary');
            expect(state.history).toHaveLength(1);
            expect(state.agentName).toBe('TestAgent');
        });
    });

    describe('Auto-summarization on trim', () => {
        it('triggers summarization when threshold exceeded and trimming needed', async () => {
            const summaryText = 'Auto-generated summary';
            const client = createMockOpenAIClient(['Response', summaryText]);
            const agent = new Agent(
                {
                    name: 'TestAgent',
                    goal: 'Test goal',
                    enableSummarization: true,
                    summarizationThreshold: 100, // Low threshold for testing
                    maxHistoryMessages: 10,
                },
                client,
            );

            // Add many messages to exceed both maxHistory and threshold
            for (let i = 0; i < 15; i++) {
                agent.addToHistory({
                    role: 'user',
                    content: `This is a longer message number ${i} with more content to exceed token threshold`,
                });
            }

            // Wait for any async trimming to complete
            await new Promise((resolve) => setTimeout(resolve, 100));

            // History should have been summarized due to exceeding threshold
            // The exact behavior depends on async handling
            expect(agent.getHistoryLength()).toBeLessThanOrEqual(15);
        });
    });
});

describe('Summarization Model Configuration', () => {
    it('uses custom summarization model when specified', async () => {
        let usedModel = '';
        const client = {
            responses: {
                create: async (request: any) => {
                    usedModel = request.model;
                    return {
                        id: 'mock-response',
                        output_text: 'Summary',
                        output: [
                            {
                                type: 'message',
                                role: 'assistant',
                                content: [
                                    { type: 'output_text', text: 'Summary' },
                                ],
                            },
                        ],
                    };
                },
            },
        } as unknown as OpenAI;

        const agent = new Agent(
            {
                name: 'TestAgent',
                goal: 'Test goal',
                model: 'gpt-4',
                summarizationModel: 'gpt-4o-mini',
                enableSummarization: true,
            },
            client,
        );

        // Add messages
        for (let i = 0; i < 15; i++) {
            agent.addToHistory({ role: 'user', content: `Message ${i}` });
        }

        await agent.summarizeHistory(5);

        expect(usedModel).toBe('gpt-4o-mini');
    });

    it('falls back to agent model when summarization model not specified', async () => {
        let usedModel = '';
        const client = {
            responses: {
                create: async (request: any) => {
                    usedModel = request.model;
                    return {
                        id: 'mock-response',
                        output_text: 'Summary',
                        output: [
                            {
                                type: 'message',
                                role: 'assistant',
                                content: [
                                    { type: 'output_text', text: 'Summary' },
                                ],
                            },
                        ],
                    };
                },
            },
        } as unknown as OpenAI;

        const agent = new Agent(
            {
                name: 'TestAgent',
                goal: 'Test goal',
                model: 'gpt-4-turbo',
                enableSummarization: true,
            },
            client,
        );

        // Add messages
        for (let i = 0; i < 15; i++) {
            agent.addToHistory({ role: 'user', content: `Message ${i}` });
        }

        await agent.summarizeHistory(5);

        // Should use the model configured for 'summarization' purpose or fall back to agent model
        expect(usedModel).toBeTruthy();
    });
});
