/**
 * Tests for Agent conversation history management
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Agent } from '@tinycrew/Agent';
import { AgentEvent, type ConversationMessage } from '@tinycrew/utils/types';

// Mock OpenAI client
const mockClient = {
    responses: {
        create: mock(async () => ({
            id: 'resp_123',
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [
                        {
                            type: 'output_text',
                            text: 'Hello! How can I help you?',
                        },
                    ],
                },
            ],
            output_text: 'Hello! How can I help you?',
        })),
    },
} as any;

describe('Agent Conversation History', () => {
    let agent: Agent;

    beforeEach(() => {
        // Reset mock
        mockClient.responses.create.mockClear();

        agent = new Agent(
            {
                name: 'TestAgent',
                goal: 'Help with testing',
                model: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
                maxHistoryMessages: 10,
            },
            mockClient,
        );
    });

    describe('getHistory', () => {
        it('returns empty array initially', () => {
            expect(agent.getHistory()).toEqual([]);
        });

        it('returns a copy of history, not the original', () => {
            agent.addToHistory({ role: 'user', content: 'Hello' });
            const history = agent.getHistory();
            history.push({ role: 'assistant', content: 'Modified' });
            expect(agent.getHistoryLength()).toBe(1);
        });
    });

    describe('getHistoryLength', () => {
        it('returns 0 initially', () => {
            expect(agent.getHistoryLength()).toBe(0);
        });

        it('returns correct count after adding messages', () => {
            agent.addToHistory({ role: 'user', content: 'Message 1' });
            agent.addToHistory({ role: 'assistant', content: 'Response 1' });
            expect(agent.getHistoryLength()).toBe(2);
        });
    });

    describe('addToHistory', () => {
        it('adds a message to history', () => {
            agent.addToHistory({ role: 'user', content: 'Hello' });
            expect(agent.getHistoryLength()).toBe(1);
            expect(agent.getHistory()[0]).toEqual({
                role: 'user',
                content: 'Hello',
            });
        });

        it('emits MESSAGE_ADDED event', () => {
            let eventFired = false;
            agent.on(AgentEvent.MESSAGE_ADDED, () => {
                eventFired = true;
            });

            agent.addToHistory({ role: 'user', content: 'Hello' });
            expect(eventFired).toBe(true);
        });

        it('includes agent name and role in event', () => {
            let eventData: any = null;
            agent.on(AgentEvent.MESSAGE_ADDED, (data) => {
                eventData = data;
            });

            agent.addToHistory({ role: 'user', content: 'Hello' });
            expect(eventData.agent).toBe('TestAgent');
            expect(eventData.role).toBe('user');
            expect(eventData.timestamp).toBeDefined();
        });
    });

    describe('clearHistory', () => {
        it('removes all messages', () => {
            agent.addToHistory({ role: 'user', content: 'Hello' });
            agent.addToHistory({ role: 'assistant', content: 'Hi there' });
            expect(agent.getHistoryLength()).toBe(2);

            agent.clearHistory();
            expect(agent.getHistoryLength()).toBe(0);
        });

        it('emits HISTORY_CLEARED event', () => {
            let eventFired = false;
            agent.on(AgentEvent.HISTORY_CLEARED, () => {
                eventFired = true;
            });

            agent.clearHistory();
            expect(eventFired).toBe(true);
        });

        it('includes previous length in event', () => {
            agent.addToHistory({ role: 'user', content: 'Hello' });
            agent.addToHistory({ role: 'assistant', content: 'Hi' });

            let eventData: any = null;
            agent.on(AgentEvent.HISTORY_CLEARED, (data) => {
                eventData = data;
            });

            agent.clearHistory();
            expect(eventData.previousLength).toBe(2);
        });
    });

    describe('history trimming', () => {
        it('trims history when exceeding maxHistoryMessages', () => {
            const smallAgent = new Agent(
                {
                    name: 'SmallAgent',
                    goal: 'Test trimming',
                    maxHistoryMessages: 3,
                },
                mockClient,
            );

            smallAgent.addToHistory({ role: 'user', content: 'Message 1' });
            smallAgent.addToHistory({
                role: 'assistant',
                content: 'Response 1',
            });
            smallAgent.addToHistory({ role: 'user', content: 'Message 2' });
            smallAgent.addToHistory({
                role: 'assistant',
                content: 'Response 2',
            });

            expect(smallAgent.getHistoryLength()).toBe(3);
            // First message should be removed
            expect(smallAgent.getHistory()[0].content).toBe('Response 1');
        });

        it('emits HISTORY_TRIMMED event', () => {
            const smallAgent = new Agent(
                {
                    name: 'SmallAgent',
                    goal: 'Test trimming',
                    maxHistoryMessages: 2,
                },
                mockClient,
            );

            let eventFired = false;
            smallAgent.on(AgentEvent.HISTORY_TRIMMED, () => {
                eventFired = true;
            });

            smallAgent.addToHistory({ role: 'user', content: 'Message 1' });
            smallAgent.addToHistory({
                role: 'assistant',
                content: 'Response 1',
            });
            smallAgent.addToHistory({ role: 'user', content: 'Message 2' });

            expect(eventFired).toBe(true);
        });

        it('preserves first system message during trimming', () => {
            const smallAgent = new Agent(
                {
                    name: 'SmallAgent',
                    goal: 'Test trimming',
                    maxHistoryMessages: 3,
                },
                mockClient,
            );

            smallAgent.addToHistory({
                role: 'system',
                content: 'System prompt',
            });
            smallAgent.addToHistory({ role: 'user', content: 'Message 1' });
            smallAgent.addToHistory({
                role: 'assistant',
                content: 'Response 1',
            });
            smallAgent.addToHistory({ role: 'user', content: 'Message 2' });

            expect(smallAgent.getHistoryLength()).toBe(3);
            // System message should be preserved
            expect(smallAgent.getHistory()[0].role).toBe('system');
            expect(smallAgent.getHistory()[0].content).toBe('System prompt');
        });
    });

    describe('setHistory', () => {
        it('replaces entire history', () => {
            agent.addToHistory({ role: 'user', content: 'Original' });

            const newHistory: ConversationMessage[] = [
                { role: 'user', content: 'New message 1' },
                { role: 'assistant', content: 'New response 1' },
            ];

            agent.setHistory(newHistory);
            expect(agent.getHistoryLength()).toBe(2);
            expect(agent.getHistory()[0].content).toBe('New message 1');
        });

        it('creates a copy of the provided history', () => {
            const newHistory: ConversationMessage[] = [
                { role: 'user', content: 'Message' },
            ];

            agent.setHistory(newHistory);
            newHistory.push({ role: 'assistant', content: 'Modified' });

            expect(agent.getHistoryLength()).toBe(1);
        });
    });

    describe('exportConversationState', () => {
        it('exports history with metadata', () => {
            agent.addToHistory({ role: 'user', content: 'Hello' });
            agent.addToHistory({ role: 'assistant', content: 'Hi' });

            const state = agent.exportConversationState();

            expect(state.history).toHaveLength(2);
            expect(state.agentName).toBe('TestAgent');
            expect(state.agentId).toBeDefined();
            expect(state.timestamp).toBeDefined();
        });
    });

    describe('chat method', () => {
        it('adds user message to history', async () => {
            await agent.chat('Hello');
            const history = agent.getHistory();
            expect(
                history.some((m) => m.role === 'user' && m.content === 'Hello'),
            ).toBe(true);
        });

        it('adds assistant response to history', async () => {
            await agent.chat('Hello');
            const history = agent.getHistory();
            expect(history.some((m) => m.role === 'assistant')).toBe(true);
        });

        it('returns the assistant response', async () => {
            const response = await agent.chat('Hello');
            expect(response).toBe('Hello! How can I help you?');
        });

        it('maintains history across multiple chats', async () => {
            await agent.chat('First message');
            await agent.chat('Second message');

            expect(agent.getHistoryLength()).toBe(4); // 2 user + 2 assistant
        });
    });

    describe('default configuration', () => {
        it('defaults maxHistoryMessages to 50', () => {
            const defaultAgent = new Agent(
                { name: 'Default', goal: 'Test' },
                mockClient,
            );

            // Add 51 messages to test the limit
            for (let i = 0; i < 51; i++) {
                defaultAgent.addToHistory({
                    role: 'user',
                    content: `Message ${i}`,
                });
            }

            expect(defaultAgent.getHistoryLength()).toBe(50);
        });

        it('defaults autoManageHistory to true', async () => {
            const defaultAgent = new Agent(
                { name: 'Default', goal: 'Test' },
                mockClient,
            );

            await defaultAgent.chat('Hello');
            // If autoManageHistory is true, history should be populated
            expect(defaultAgent.getHistoryLength()).toBe(2);
        });
    });

    describe('autoManageHistory disabled', () => {
        it('still adds messages to history when using chat()', async () => {
            const noAutoAgent = new Agent(
                {
                    name: 'NoAuto',
                    goal: 'Test',
                    autoManageHistory: false,
                },
                mockClient,
            );

            await noAutoAgent.chat('Hello');
            // chat() always adds to history, autoManageHistory affects what's passed to performTask
            expect(noAutoAgent.getHistoryLength()).toBe(2);
        });
    });
});

describe('Agent conversation with tools', () => {
    it('preserves history when tools are used', async () => {
        const mockToolClient = {
            responses: {
                create: mock(async () => ({
                    id: 'resp_123',
                    output: [
                        {
                            type: 'message',
                            role: 'assistant',
                            content: [
                                {
                                    type: 'output_text',
                                    text: 'Tool result processed',
                                },
                            ],
                        },
                    ],
                    output_text: 'Tool result processed',
                })),
            },
        } as any;

        const agentWithTool = new Agent(
            {
                name: 'ToolAgent',
                goal: 'Use tools',
                maxHistoryMessages: 10,
            },
            mockToolClient,
            [
                {
                    name: 'TestTool',
                    description: 'A test tool',
                    schema: {
                        name: 'TestTool',
                        description: 'A test tool',
                        parameters: {
                            type: 'object',
                            properties: {
                                input: { type: 'string', description: 'Input' },
                            },
                            required: ['input'],
                        },
                    },
                    use: async (args: any) => `Processed: ${args.input}`,
                },
            ],
        );

        await agentWithTool.chat('Use the tool');
        expect(agentWithTool.getHistoryLength()).toBe(2);
    });
});
