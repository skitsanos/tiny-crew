/**
 * Mock OpenAI Client for Testing
 *
 * Provides a mock implementation of the OpenAI client that returns
 * predetermined responses, enabling fast, deterministic tests without
 * API calls.
 */

import type OpenAI from 'openai';
import type { Response } from 'openai/resources/responses/responses';

/**
 * Configuration for mock responses
 */
export interface MockResponseConfig {
    /** Text responses to return in sequence */
    responses?: string[];
    /** Tool calls to simulate */
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, any>;
    }>;
    /** Whether to simulate streaming */
    streaming?: boolean;
    /** Delay between responses in ms (for realistic timing) */
    delay?: number;
    /** Error to throw (for testing error handling) */
    error?: Error;
}

/**
 * Statistics tracked by the mock client
 */
export interface MockClientStats {
    totalCalls: number;
    lastModel: string | null;
    lastInput: any[] | null;
    callHistory: Array<{
        model: string;
        input: any[];
        timestamp: number;
    }>;
}

/**
 * Create a mock OpenAI client for testing
 *
 * @param config Configuration for mock behavior
 * @returns Mock OpenAI client and stats tracker
 *
 * @example
 * ```typescript
 * const { client, stats } = createMockOpenAIClient({
 *     responses: ['Hello!', 'How can I help?']
 * });
 *
 * const agent = new Agent({ name: 'Test' }, client);
 * await agent.chat('Hi'); // Returns 'Hello!'
 * await agent.chat('Help'); // Returns 'How can I help?'
 *
 * expect(stats.totalCalls).toBe(2);
 * ```
 */
export function createMockOpenAIClient(config: MockResponseConfig = {}): {
    client: OpenAI;
    stats: MockClientStats;
} {
    const {
        responses = ['Mock response'],
        toolCalls,
        delay = 0,
        error
    } = config;

    let callCount = 0;
    const stats: MockClientStats = {
        totalCalls: 0,
        lastModel: null,
        lastInput: null,
        callHistory: []
    };

    const mockClient = {
        responses: {
            create: async (params: {
                model: string;
                input: any[];
                tools?: any[];
                temperature?: number;
                max_output_tokens?: number;
            }): Promise<Response> => {
                // Track stats
                stats.totalCalls++;
                stats.lastModel = params.model;
                stats.lastInput = params.input;
                stats.callHistory.push({
                    model: params.model,
                    input: params.input,
                    timestamp: Date.now()
                });

                // Simulate delay if configured
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                // Throw error if configured
                if (error) {
                    throw error;
                }

                // Get response text
                const responseText = responses[callCount % responses.length];
                callCount++;

                // Build response output
                const output: any[] = [];

                // Add tool calls if configured
                if (toolCalls && toolCalls.length > 0) {
                    for (const tc of toolCalls) {
                        output.push({
                            type: 'function_call',
                            id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                            name: tc.name,
                            arguments: JSON.stringify(tc.arguments)
                        });
                    }
                }

                // Add text response
                output.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: responseText }]
                });

                return {
                    id: `mock-response-${stats.totalCalls}`,
                    object: 'response',
                    created_at: Date.now(),
                    model: params.model,
                    output,
                    output_text: responseText,
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        total_tokens: 150
                    }
                } as Response;
            }
        }
    } as unknown as OpenAI;

    return { client: mockClient, stats };
}

/**
 * Create a mock client that returns JSON responses
 *
 * @param jsonResponses Array of objects to return as JSON strings
 */
export function createMockJsonClient(jsonResponses: object[]): {
    client: OpenAI;
    stats: MockClientStats;
} {
    const responses = jsonResponses.map(obj => JSON.stringify(obj));
    return createMockOpenAIClient({ responses });
}

/**
 * Create a mock client that simulates errors
 *
 * @param error Error to throw on each call
 */
export function createMockErrorClient(error: Error): {
    client: OpenAI;
    stats: MockClientStats;
} {
    return createMockOpenAIClient({ error });
}

/**
 * Create a mock client with tool call responses
 *
 * @param toolCalls Tool calls to simulate
 * @param finalResponse Final text response after tool calls
 */
export function createMockToolClient(
    toolCalls: Array<{ name: string; arguments: Record<string, any> }>,
    finalResponse: string = 'Task completed'
): {
    client: OpenAI;
    stats: MockClientStats;
} {
    return createMockOpenAIClient({
        toolCalls,
        responses: [finalResponse]
    });
}

/**
 * Create a mock client with conversation-style responses
 * Useful for testing multi-turn conversations
 *
 * @param conversationPairs Array of [userPattern, response] pairs
 */
export function createConversationalMockClient(
    conversationPairs: Array<[RegExp | string, string]>
): {
    client: OpenAI;
    stats: MockClientStats;
    getResponseFor: (input: string) => string;
} {
    const stats: MockClientStats = {
        totalCalls: 0,
        lastModel: null,
        lastInput: null,
        callHistory: []
    };

    const getResponseFor = (input: string): string => {
        for (const [pattern, response] of conversationPairs) {
            if (typeof pattern === 'string') {
                if (input.toLowerCase().includes(pattern.toLowerCase())) {
                    return response;
                }
            } else if (pattern.test(input)) {
                return response;
            }
        }
        return 'I don\'t understand.';
    };

    const mockClient = {
        responses: {
            create: async (params: { model: string; input: any[] }): Promise<Response> => {
                stats.totalCalls++;
                stats.lastModel = params.model;
                stats.lastInput = params.input;
                stats.callHistory.push({
                    model: params.model,
                    input: params.input,
                    timestamp: Date.now()
                });

                // Extract user message from input
                const userMessage = params.input
                    .filter((m: any) => m.role === 'user')
                    .map((m: any) => m.content)
                    .join(' ');

                const responseText = getResponseFor(userMessage);

                return {
                    id: `mock-response-${stats.totalCalls}`,
                    object: 'response',
                    created_at: Date.now(),
                    model: params.model,
                    output: [{
                        type: 'message',
                        role: 'assistant',
                        content: [{ type: 'output_text', text: responseText }]
                    }],
                    output_text: responseText,
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        total_tokens: 150
                    }
                } as Response;
            }
        }
    } as unknown as OpenAI;

    return { client: mockClient, stats, getResponseFor };
}

export default createMockOpenAIClient;
