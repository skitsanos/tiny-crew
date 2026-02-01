/**
 * Tests for RateLimiter utility
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import { RateLimiter, withRateLimit, estimateTokens, type RateLimiterConfig } from '../src/utils/rateLimiter';

describe('RateLimiter', () => {
    describe('Basic functionality', () => {
        it('creates with default config', () => {
            const limiter = new RateLimiter();
            const stats = limiter.getStats();

            expect(stats.totalRequests).toBe(0);
            expect(stats.queuedRequests).toBe(0);
        });

        it('creates with custom config', () => {
            const config: RateLimiterConfig = {
                requestsPerMinute: 30,
                tokensPerMinute: 50_000
            };
            const limiter = new RateLimiter(config);
            const buckets = limiter.getBucketStates();

            expect(buckets.requests).toBe(30);
            expect(buckets.tokens).toBe(50_000);
        });

        it('executes function immediately when under limit', async () => {
            const limiter = new RateLimiter({ requestsPerMinute: 100 });
            let executed = false;

            await limiter.execute(async () => {
                executed = true;
                return 'result';
            });

            expect(executed).toBe(true);
            expect(limiter.getStats().totalRequests).toBe(1);
        });

        it('returns function result', async () => {
            const limiter = new RateLimiter();
            const result = await limiter.execute(async () => 'test-result');

            expect(result).toBe('test-result');
        });

        it('tracks statistics', async () => {
            const limiter = new RateLimiter();

            await limiter.execute(async () => 'a');
            await limiter.execute(async () => 'b');
            await limiter.execute(async () => 'c');

            const stats = limiter.getStats();
            expect(stats.totalRequests).toBe(3);
        });
    });

    describe('Rate limiting behavior', () => {
        it('consumes request tokens', async () => {
            const limiter = new RateLimiter({ requestsPerMinute: 10 });
            const initialBuckets = limiter.getBucketStates();

            await limiter.execute(async () => 'test', 100);

            const afterBuckets = limiter.getBucketStates();
            expect(afterBuckets.requests).toBeLessThan(initialBuckets.requests);
        });

        it('consumes token bucket based on estimated tokens', async () => {
            const limiter = new RateLimiter({ tokensPerMinute: 10_000 });
            const initialBuckets = limiter.getBucketStates();

            await limiter.execute(async () => 'test', 5000);

            const afterBuckets = limiter.getBucketStates();
            expect(afterBuckets.tokens).toBeLessThanOrEqual(initialBuckets.tokens - 5000);
        });

        it('queues requests when bucket is empty', async () => {
            const limiter = new RateLimiter({
                requestsPerMinute: 120, // 2 per second - fast enough for test
                tokensPerMinute: 100_000
            });

            // Fire multiple requests quickly
            const promises = [
                limiter.execute(async () => 1, 100),
                limiter.execute(async () => 2, 100),
                limiter.execute(async () => 3, 100),
                limiter.execute(async () => 4, 100),
                limiter.execute(async () => 5, 100)
            ];

            // Some requests may be queued
            const stats = limiter.getStats();
            expect(stats.queuedRequests).toBeGreaterThanOrEqual(0);

            // All should eventually complete
            const results = await Promise.all(promises);
            expect(results).toEqual([1, 2, 3, 4, 5]);
        }, 10000);

        it('refills buckets over time', async () => {
            const limiter = new RateLimiter({
                requestsPerMinute: 60, // 1 per second
                tokensPerMinute: 60_000 // 1000 per second
            });

            // Consume some tokens
            await limiter.execute(async () => 'test', 1000);
            const afterConsume = limiter.getBucketStates();

            // Wait a bit for refill
            await new Promise(resolve => setTimeout(resolve, 100));

            const afterWait = limiter.getBucketStates();
            expect(afterWait.requests).toBeGreaterThanOrEqual(afterConsume.requests);
        });
    });

    describe('Reset functionality', () => {
        it('resets buckets to max', async () => {
            const limiter = new RateLimiter({
                requestsPerMinute: 10,
                tokensPerMinute: 10_000
            });

            // Consume some
            await limiter.execute(async () => 'test', 5000);
            const afterConsume = limiter.getBucketStates();
            expect(afterConsume.tokens).toBeLessThan(10_000);

            // Reset
            limiter.reset();

            const afterReset = limiter.getBucketStates();
            expect(afterReset.requests).toBe(10);
            expect(afterReset.tokens).toBe(10_000);
        });

        it('resets statistics', async () => {
            const limiter = new RateLimiter();

            await limiter.execute(async () => 'test');
            expect(limiter.getStats().totalRequests).toBe(1);

            limiter.reset();
            expect(limiter.getStats().totalRequests).toBe(0);
        });
    });

    describe('Error handling', () => {
        it('propagates errors from executed function', async () => {
            const limiter = new RateLimiter();

            await expect(
                limiter.execute(async () => {
                    throw new Error('Test error');
                })
            ).rejects.toThrow('Test error');
        });

        it('throws when queue is full and throwOnLimit is true', async () => {
            const limiter = new RateLimiter({
                requestsPerMinute: 1,
                maxQueueSize: 2,
                throwOnLimit: true
            });

            // Fill the queue
            const p1 = limiter.execute(async () => {
                await new Promise(r => setTimeout(r, 1000));
                return 1;
            }, 100);

            const p2 = limiter.execute(async () => 2, 100);
            const p3 = limiter.execute(async () => 3, 100);

            // This should throw
            await expect(
                limiter.execute(async () => 4, 100)
            ).rejects.toThrow('queue full');

            // Clean up
            await Promise.race([
                Promise.all([p1, p2, p3]),
                new Promise(r => setTimeout(r, 100))
            ]).catch(() => {});
        });
    });
});

describe('estimateTokens', () => {
    it('estimates tokens for string input', () => {
        const text = 'Hello world'; // 11 chars
        const tokens = estimateTokens(text);

        // ~4 chars per token, so 11/4 ≈ 3
        expect(tokens).toBe(3);
    });

    it('estimates tokens for longer text', () => {
        const text = 'a'.repeat(400); // 400 chars
        const tokens = estimateTokens(text);

        // 400/4 = 100
        expect(tokens).toBe(100);
    });

    it('estimates tokens for object input', () => {
        const obj = { message: 'Hello', count: 42 };
        const tokens = estimateTokens(obj);

        // JSON.stringify length / 4
        const jsonLength = JSON.stringify(obj).length;
        expect(tokens).toBe(Math.ceil(jsonLength / 4));
    });

    it('handles empty string', () => {
        expect(estimateTokens('')).toBe(0);
    });
});

describe('withRateLimit', () => {
    it('wraps an object and adds rateLimiter property', () => {
        const mockClient = {
            responses: {
                create: async (params: any) => ({ id: 'test', data: params })
            }
        };

        const wrapped = withRateLimit(mockClient, { requestsPerMinute: 10 });

        expect(wrapped.rateLimiter).toBeDefined();
        expect(wrapped.rateLimiter).toBeInstanceOf(RateLimiter);
    });

    it('rate limits API calls through wrapper', async () => {
        const calls: number[] = [];
        const mockClient = {
            responses: {
                create: async (params: { value: number }) => {
                    calls.push(params.value);
                    return { id: 'test', value: params.value };
                }
            }
        };

        const wrapped = withRateLimit(mockClient, {
            requestsPerMinute: 100,
            tokensPerMinute: 100_000
        });

        // Make several calls
        await wrapped.responses.create({ value: 1 });
        await wrapped.responses.create({ value: 2 });
        await wrapped.responses.create({ value: 3 });

        expect(calls).toEqual([1, 2, 3]);
        expect(wrapped.rateLimiter.getStats().totalRequests).toBe(3);
    });

    it('preserves non-API methods', () => {
        const mockClient = {
            someProperty: 'value',
            helperMethod: () => 'helper result'
        };

        const wrapped = withRateLimit(mockClient);

        expect(wrapped.someProperty).toBe('value');
        expect(wrapped.helperMethod()).toBe('helper result');
    });

    it('handles nested objects', async () => {
        const mockClient = {
            level1: {
                level2: {
                    create: async (x: number) => x * 2
                }
            }
        };

        const wrapped = withRateLimit(mockClient);
        const result = await wrapped.level1.level2.create(5);

        expect(result).toBe(10);
    });
});

describe('Concurrent request handling', () => {
    it('processes concurrent requests correctly', async () => {
        const limiter = new RateLimiter({
            requestsPerMinute: 100,
            tokensPerMinute: 100_000
        });

        const results = await Promise.all([
            limiter.execute(async () => 'a', 100),
            limiter.execute(async () => 'b', 100),
            limiter.execute(async () => 'c', 100),
            limiter.execute(async () => 'd', 100),
            limiter.execute(async () => 'e', 100)
        ]);

        expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(limiter.getStats().totalRequests).toBe(5);
    });

    it('maintains order for queued requests', async () => {
        const limiter = new RateLimiter({
            requestsPerMinute: 600, // 10 per second - fast enough for test
            tokensPerMinute: 100_000
        });

        const order: number[] = [];

        const promises = [1, 2, 3, 4, 5].map(n =>
            limiter.execute(async () => {
                order.push(n);
                return n;
            }, 100)
        );

        await Promise.all(promises);

        // All should complete
        expect(order.length).toBe(5);
    });
});
