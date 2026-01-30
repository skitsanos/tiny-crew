/**
 * Tests for Agent streaming response functionality
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Agent } from '@/Agent';
import { AgentEvent, type StreamChunk } from '@/utils/types';

// Helper to create an async iterable from events
function createMockStreamIterator(events: any[]): AsyncIterable<any> {
    return {
        [Symbol.asyncIterator]() {
            let index = 0;
            return {
                async next() {
                    if (index < events.length) {
                        return { value: events[index++], done: false };
                    }
                    return { value: undefined, done: true };
                }
            };
        }
    };
}

describe('Agent Streaming', () => {
    let agent: Agent;

    describe('chatStream', () => {
        beforeEach(() => {
            // Create a mock that returns a stream
            const mockStreamClient = {
                responses: {
                    create: mock(async (request: any) => {
                        if (request.stream) {
                            // Return a mock async iterable for streaming
                            return createMockStreamIterator([
                                { type: 'response.output_text.delta', delta: 'Hello' },
                                { type: 'response.output_text.delta', delta: ' there!' },
                                { type: 'response.done' }
                            ]);
                        }
                        // Non-streaming response (for tool synthesis)
                        return {
                            id: 'resp_123',
                            output: [
                                {
                                    type: 'message',
                                    role: 'assistant',
                                    content: [{ type: 'output_text', text: 'Synthesized response' }]
                                }
                            ],
                            output_text: 'Synthesized response'
                        };
                    })
                }
            } as any;

            agent = new Agent(
                {
                    name: 'StreamAgent',
                    goal: 'Test streaming',
                    model: 'gpt-4o-mini'
                },
                mockStreamClient
            );
        });

        it('yields text chunks as they arrive', async () => {
            const chunks: StreamChunk[] = [];

            for await (const chunk of agent.chatStream('Hello')) {
                chunks.push(chunk);
            }

            const textChunks = chunks.filter(c => c.type === 'text');
            expect(textChunks.length).toBe(2);
            expect(textChunks[0].content).toBe('Hello');
            expect(textChunks[1].content).toBe(' there!');
        });

        it('yields a done chunk at the end', async () => {
            const chunks: StreamChunk[] = [];

            for await (const chunk of agent.chatStream('Hello')) {
                chunks.push(chunk);
            }

            const doneChunk = chunks.find(c => c.type === 'done');
            expect(doneChunk).toBeDefined();
            expect(doneChunk?.isComplete).toBe(true);
        });

        it('adds user message to history before streaming', async () => {
            // Start streaming but don't consume
            const stream = agent.chatStream('Test message');
            // Consume the stream
            for await (const _ of stream) {
                // Just consume
            }

            const history = agent.getHistory();
            expect(history.some(m => m.role === 'user' && m.content === 'Test message')).toBe(true);
        });

        it('adds assistant response to history after streaming completes', async () => {
            for await (const _ of agent.chatStream('Hello')) {
                // Consume
            }

            const history = agent.getHistory();
            expect(history.some(m => m.role === 'assistant')).toBe(true);
        });

        it('calls onChunk callback for each chunk', async () => {
            const receivedChunks: StreamChunk[] = [];

            for await (const _ of agent.chatStream('Hello', '', (chunk) => {
                receivedChunks.push(chunk);
            })) {
                // Consume via iteration as well
            }

            expect(receivedChunks.length).toBeGreaterThan(0);
            expect(receivedChunks.some(c => c.type === 'text')).toBe(true);
        });

        it('returns full response text', async () => {
            let fullResponse = '';

            const stream = agent.chatStream('Hello');
            for await (const chunk of stream) {
                if (chunk.content) {
                    fullResponse += chunk.content;
                }
            }

            expect(fullResponse).toBe('Hello there!');
        });
    });

    describe('performTaskStream', () => {
        beforeEach(() => {
            const mockStreamClient = {
                responses: {
                    create: mock(async (request: any) => {
                        if (request.stream) {
                            return createMockStreamIterator([
                                { type: 'response.output_text.delta', delta: 'Streaming' },
                                { type: 'response.output_text.delta', delta: ' response' },
                                { type: 'response.done' }
                            ]);
                        }
                        return {
                            id: 'resp_123',
                            output: [],
                            output_text: 'Non-streaming'
                        };
                    })
                }
            } as any;

            agent = new Agent(
                {
                    name: 'TaskStreamAgent',
                    goal: 'Test task streaming'
                },
                mockStreamClient
            );
        });

        it('emits TASK_STARTED event with streaming flag', async () => {
            let eventData: any = null;

            agent.on(AgentEvent.TASK_STARTED, (data) => {
                eventData = data;
            });

            for await (const _ of agent.performTaskStream('Test task')) {
                // Consume
            }

            expect(eventData).not.toBeNull();
            expect(eventData.streaming).toBe(true);
        });

        it('emits STREAM_CHUNK events', async () => {
            const chunkEvents: any[] = [];

            agent.on(AgentEvent.STREAM_CHUNK, (data) => {
                chunkEvents.push(data);
            });

            for await (const _ of agent.performTaskStream('Test task')) {
                // Consume
            }

            expect(chunkEvents.length).toBeGreaterThan(0);
            expect(chunkEvents[0].agent).toBe('TaskStreamAgent');
        });

        it('emits STREAM_END event with full text', async () => {
            let endEvent: any = null;

            agent.on(AgentEvent.STREAM_END, (data) => {
                endEvent = data;
            });

            for await (const _ of agent.performTaskStream('Test task')) {
                // Consume
            }

            expect(endEvent).not.toBeNull();
            expect(endEvent.fullText).toBe('Streaming response');
        });

        it('emits TASK_COMPLETED event', async () => {
            let completedEvent: any = null;

            agent.on(AgentEvent.TASK_COMPLETED, (data) => {
                completedEvent = data;
            });

            for await (const _ of agent.performTaskStream('Test task')) {
                // Consume
            }

            expect(completedEvent).not.toBeNull();
            expect(completedEvent.metadata?.streaming).toBe(true);
        });
    });

    describe('streaming with tools', () => {
        it('handles tool calls in stream', async () => {
            const mockToolStreamClient = {
                responses: {
                    create: mock(async (request: any) => {
                        if (request.stream) {
                            return createMockStreamIterator([
                                {
                                    type: 'response.output_item.added',
                                    item: {
                                        type: 'function_call',
                                        call_id: 'call_123',
                                        name: 'TestTool'
                                    }
                                },
                                {
                                    type: 'response.function_call_arguments.delta',
                                    call_id: 'call_123',
                                    delta: '{"input":'
                                },
                                {
                                    type: 'response.function_call_arguments.delta',
                                    call_id: 'call_123',
                                    delta: '"test"}'
                                },
                                {
                                    type: 'response.output_item.done',
                                    item: {
                                        type: 'function_call',
                                        call_id: 'call_123',
                                        name: 'TestTool',
                                        arguments: '{"input":"test"}'
                                    }
                                },
                                { type: 'response.done' }
                            ]);
                        }
                        // Synthesis response after tool execution
                        return {
                            id: 'resp_456',
                            output: [
                                {
                                    type: 'message',
                                    role: 'assistant',
                                    content: [{ type: 'output_text', text: 'Tool executed successfully' }]
                                }
                            ],
                            output_text: 'Tool executed successfully'
                        };
                    })
                }
            } as any;

            const toolAgent = new Agent(
                {
                    name: 'ToolStreamAgent',
                    goal: 'Test tools with streaming'
                },
                mockToolStreamClient,
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
                                    input: { type: 'string', description: 'Input value' }
                                },
                                required: ['input']
                            }
                        },
                        use: async (args: any) => `Processed: ${args.input}`
                    }
                ]
            );

            const chunks: StreamChunk[] = [];

            for await (const chunk of toolAgent.chatStream('Use the tool')) {
                chunks.push(chunk);
            }

            // Should have tool_call_start and tool_call_end chunks
            expect(chunks.some(c => c.type === 'tool_call_start')).toBe(true);
            expect(chunks.some(c => c.type === 'tool_call_end')).toBe(true);

            // The tool_call_end should contain the result
            const toolEndChunk = chunks.find(c => c.type === 'tool_call_end');
            expect(toolEndChunk?.content).toContain('Processed: test');
        });

        it('emits TOOL_USED event during stream', async () => {
            const mockToolStreamClient = {
                responses: {
                    create: mock(async (request: any) => {
                        if (request.stream) {
                            return createMockStreamIterator([
                                {
                                    type: 'response.output_item.done',
                                    item: {
                                        type: 'function_call',
                                        call_id: 'call_abc',
                                        name: 'SimpleTool',
                                        arguments: '{}'
                                    }
                                },
                                { type: 'response.done' }
                            ]);
                        }
                        return {
                            id: 'resp_789',
                            output_text: 'Done'
                        };
                    })
                }
            } as any;

            const toolAgent = new Agent(
                { name: 'EventToolAgent', goal: 'Test events' },
                mockToolStreamClient,
                [
                    {
                        name: 'SimpleTool',
                        description: 'Simple',
                        schema: {
                            name: 'SimpleTool',
                            description: 'Simple',
                            parameters: { type: 'object', properties: {}, required: [] }
                        },
                        use: async () => 'result'
                    }
                ]
            );

            let toolUsedEvent: any = null;
            toolAgent.on(AgentEvent.TOOL_USED, (data) => {
                toolUsedEvent = data;
            });

            for await (const _ of toolAgent.chatStream('Do something')) {
                // Consume
            }

            expect(toolUsedEvent).not.toBeNull();
            expect(toolUsedEvent.tool).toBe('SimpleTool');
        });
    });

    describe('streaming error handling', () => {
        it('emits TASK_FAILED on error', async () => {
            const errorClient = {
                responses: {
                    create: mock(async () => {
                        throw new Error('Stream failed');
                    })
                }
            } as any;

            const errorAgent = new Agent(
                { name: 'ErrorAgent', goal: 'Test errors' },
                errorClient
            );

            let failedEvent: any = null;
            errorAgent.on(AgentEvent.TASK_FAILED, (data) => {
                failedEvent = data;
            });

            try {
                for await (const _ of errorAgent.chatStream('Hello')) {
                    // Should not reach here
                }
            } catch (e) {
                // Expected
            }

            expect(failedEvent).not.toBeNull();
            expect(failedEvent.error.message).toBe('Stream failed');
        });

        it('throws error to caller', async () => {
            const errorClient = {
                responses: {
                    create: mock(async () => {
                        throw new Error('API error');
                    })
                }
            } as any;

            const errorAgent = new Agent(
                { name: 'ThrowAgent', goal: 'Test throws' },
                errorClient
            );

            let caughtError: Error | null = null;

            try {
                for await (const _ of errorAgent.performTaskStream('Test')) {
                    // Consume
                }
            } catch (e) {
                caughtError = e as Error;
            }

            expect(caughtError).not.toBeNull();
            expect(caughtError?.message).toBe('API error');
        });
    });

    describe('streaming with context', () => {
        it('includes memory context in request', async () => {
            let capturedRequest: any = null;

            const contextClient = {
                responses: {
                    create: mock(async (request: any) => {
                        capturedRequest = request;
                        if (request.stream) {
                            return createMockStreamIterator([
                                { type: 'response.output_text.delta', delta: 'With context' },
                                { type: 'response.done' }
                            ]);
                        }
                        return { output_text: '' };
                    })
                }
            } as any;

            const contextAgent = new Agent(
                { name: 'ContextAgent', goal: 'Test context' },
                contextClient
            );

            const memoryContext = 'Important memory: User likes TypeScript';

            for await (const _ of contextAgent.performTaskStream('Hello', memoryContext)) {
                // Consume
            }

            expect(capturedRequest).not.toBeNull();
            // Check that the context was included in the conversation
            const inputMessages = capturedRequest.input;
            const hasContext = inputMessages.some((m: any) =>
                m.content?.some?.((c: any) => c.text?.includes('Important memory'))
            );
            expect(hasContext).toBe(true);
        });

        it('includes chat history in request', async () => {
            let capturedRequest: any = null;

            const historyClient = {
                responses: {
                    create: mock(async (request: any) => {
                        capturedRequest = request;
                        if (request.stream) {
                            return createMockStreamIterator([
                                { type: 'response.output_text.delta', delta: 'Response' },
                                { type: 'response.done' }
                            ]);
                        }
                        return { output_text: '' };
                    })
                }
            } as any;

            const historyAgent = new Agent(
                { name: 'HistoryAgent', goal: 'Test history' },
                historyClient
            );

            const chatHistory = [
                { role: 'user' as const, content: 'Previous question' },
                { role: 'assistant' as const, content: 'Previous answer' }
            ];

            for await (const _ of historyAgent.performTaskStream('New question', '', chatHistory)) {
                // Consume
            }

            expect(capturedRequest).not.toBeNull();
            const inputMessages = capturedRequest.input;
            const hasPreviousQuestion = inputMessages.some((m: any) =>
                m.content?.some?.((c: any) => c.text === 'Previous question')
            );
            expect(hasPreviousQuestion).toBe(true);
        });
    });
});
