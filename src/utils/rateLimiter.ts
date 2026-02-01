/**
 * RateLimiter - Token bucket rate limiter for OpenAI API calls
 *
 * Supports:
 * - Requests per minute (RPM) limiting
 * - Tokens per minute (TPM) limiting
 * - Automatic queuing and retry
 */

import Logger from './logger';

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
    /** Maximum requests per minute (default: 60) */
    requestsPerMinute?: number;
    /** Maximum tokens per minute (default: 100,000) */
    tokensPerMinute?: number;
    /** Maximum queue size before rejecting requests (default: 100) */
    maxQueueSize?: number;
    /** Whether to throw on rate limit or queue (default: false - queue) */
    throwOnLimit?: boolean;
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
    tokens: number;
    maxTokens: number;
    refillRate: number; // tokens per ms
    lastRefill: number;
}

/**
 * Queued request
 */
interface QueuedRequest<T> {
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    estimatedTokens: number;
    timestamp: number;
}

/**
 * Rate limiter statistics
 */
export interface RateLimiterStats {
    totalRequests: number;
    queuedRequests: number;
    currentQueueSize: number;
    requestsThisMinute: number;
    tokensThisMinute: number;
    rateLimitHits: number;
}

/**
 * RateLimiter class implementing token bucket algorithm
 */
export class RateLimiter {
    private readonly requestBucket: TokenBucket;
    private readonly tokenBucket: TokenBucket;
    private readonly queue: QueuedRequest<any>[] = [];
    private readonly config: Required<RateLimiterConfig>;
    private readonly logger: Logger;
    private processing = false;
    private stats: RateLimiterStats = {
        totalRequests: 0,
        queuedRequests: 0,
        currentQueueSize: 0,
        requestsThisMinute: 0,
        tokensThisMinute: 0,
        rateLimitHits: 0
    };
    private minuteStartTime: number = Date.now();

    constructor(config: RateLimiterConfig = {}, logger?: Logger) {
        this.config = {
            requestsPerMinute: config.requestsPerMinute ?? 60,
            tokensPerMinute: config.tokensPerMinute ?? 100_000,
            maxQueueSize: config.maxQueueSize ?? 100,
            throwOnLimit: config.throwOnLimit ?? false
        };

        this.logger = logger ?? new Logger('RateLimiter');

        // Initialize request bucket (RPM)
        this.requestBucket = {
            tokens: this.config.requestsPerMinute,
            maxTokens: this.config.requestsPerMinute,
            refillRate: this.config.requestsPerMinute / 60_000, // per ms
            lastRefill: Date.now()
        };

        // Initialize token bucket (TPM)
        this.tokenBucket = {
            tokens: this.config.tokensPerMinute,
            maxTokens: this.config.tokensPerMinute,
            refillRate: this.config.tokensPerMinute / 60_000, // per ms
            lastRefill: Date.now()
        };

        this.logger.info(`RateLimiter initialized: ${this.config.requestsPerMinute} RPM, ${this.config.tokensPerMinute} TPM`);
    }

    /**
     * Refill a token bucket based on elapsed time
     */
    private refillBucket(bucket: TokenBucket): void {
        const now = Date.now();
        const elapsed = now - bucket.lastRefill;
        const refillAmount = elapsed * bucket.refillRate;

        bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + refillAmount);
        bucket.lastRefill = now;
    }

    /**
     * Check if we can make a request with estimated tokens
     */
    private canProceed(estimatedTokens: number): boolean {
        this.refillBucket(this.requestBucket);
        this.refillBucket(this.tokenBucket);

        return this.requestBucket.tokens >= 1 && this.tokenBucket.tokens >= estimatedTokens;
    }

    /**
     * Consume tokens from buckets
     */
    private consume(estimatedTokens: number): void {
        this.requestBucket.tokens -= 1;
        this.tokenBucket.tokens -= estimatedTokens;
    }

    /**
     * Calculate wait time until we can proceed
     */
    private getWaitTime(estimatedTokens: number): number {
        this.refillBucket(this.requestBucket);
        this.refillBucket(this.tokenBucket);

        const requestWait = this.requestBucket.tokens < 1
            ? (1 - this.requestBucket.tokens) / this.requestBucket.refillRate
            : 0;

        const tokenWait = this.tokenBucket.tokens < estimatedTokens
            ? (estimatedTokens - this.tokenBucket.tokens) / this.tokenBucket.refillRate
            : 0;

        return Math.max(requestWait, tokenWait);
    }

    /**
     * Update minute-based stats
     */
    private updateMinuteStats(tokens: number): void {
        const now = Date.now();
        if (now - this.minuteStartTime > 60_000) {
            this.stats.requestsThisMinute = 0;
            this.stats.tokensThisMinute = 0;
            this.minuteStartTime = now;
        }
        this.stats.requestsThisMinute++;
        this.stats.tokensThisMinute += tokens;
    }

    /**
     * Process the queue
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const request = this.queue[0];

            if (this.canProceed(request.estimatedTokens)) {
                this.queue.shift();
                this.stats.currentQueueSize = this.queue.length;
                this.consume(request.estimatedTokens);
                this.updateMinuteStats(request.estimatedTokens);
                this.stats.totalRequests++;

                try {
                    const result = await request.execute();
                    request.resolve(result);
                } catch (error) {
                    request.reject(error as Error);
                }
            } else {
                const waitTime = this.getWaitTime(request.estimatedTokens);
                this.logger.debug(`Rate limited, waiting ${Math.ceil(waitTime)}ms`);
                this.stats.rateLimitHits++;
                await new Promise(resolve => setTimeout(resolve, Math.ceil(waitTime)));
            }
        }

        this.processing = false;
    }

    /**
     * Execute a function with rate limiting
     * @param fn - Function to execute
     * @param estimatedTokens - Estimated tokens for this request
     */
    async execute<T>(fn: () => Promise<T>, estimatedTokens: number = 1000): Promise<T> {
        // Check if we can proceed immediately
        if (this.canProceed(estimatedTokens) && this.queue.length === 0) {
            this.consume(estimatedTokens);
            this.updateMinuteStats(estimatedTokens);
            this.stats.totalRequests++;
            return fn();
        }

        // Check queue size
        if (this.queue.length >= this.config.maxQueueSize) {
            if (this.config.throwOnLimit) {
                throw new Error(`Rate limiter queue full (${this.config.maxQueueSize} requests)`);
            }
            // Wait for queue to clear
            this.logger.warn(`Queue full, waiting for space...`);
        }

        // Queue the request
        return new Promise<T>((resolve, reject) => {
            this.queue.push({
                execute: fn,
                resolve,
                reject,
                estimatedTokens,
                timestamp: Date.now()
            });
            this.stats.queuedRequests++;
            this.stats.currentQueueSize = this.queue.length;
            this.logger.debug(`Request queued, queue size: ${this.queue.length}`);

            // Start processing if not already
            this.processQueue();
        });
    }

    /**
     * Get current statistics
     */
    getStats(): RateLimiterStats {
        return { ...this.stats };
    }

    /**
     * Get current bucket states
     */
    getBucketStates(): { requests: number; tokens: number } {
        this.refillBucket(this.requestBucket);
        this.refillBucket(this.tokenBucket);
        return {
            requests: Math.floor(this.requestBucket.tokens),
            tokens: Math.floor(this.tokenBucket.tokens)
        };
    }

    /**
     * Reset the rate limiter
     */
    reset(): void {
        this.requestBucket.tokens = this.requestBucket.maxTokens;
        this.tokenBucket.tokens = this.tokenBucket.maxTokens;
        this.requestBucket.lastRefill = Date.now();
        this.tokenBucket.lastRefill = Date.now();
        this.stats = {
            totalRequests: 0,
            queuedRequests: 0,
            currentQueueSize: 0,
            requestsThisMinute: 0,
            tokensThisMinute: 0,
            rateLimitHits: 0
        };
        this.logger.info('RateLimiter reset');
    }
}

/**
 * Estimate tokens for a request based on input
 * Uses rough approximation: ~4 characters per token
 */
export function estimateTokens(input: string | object): number {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return Math.ceil(text.length / 4);
}

/**
 * Rate-limited client interface
 */
export interface RateLimitedClient<T> {
    /** The rate limiter instance for stats and control */
    rateLimiter: RateLimiter;
    /** The wrapped client */
    client: T;
}

/**
 * Create a rate-limited wrapper for an OpenAI client
 *
 * @example
 * ```typescript
 * const client = new OpenAI();
 * const rateLimitedClient = withRateLimit(client, {
 *     requestsPerMinute: 60,
 *     tokensPerMinute: 100_000
 * });
 *
 * // Use rateLimitedClient like a normal OpenAI client
 * const response = await rateLimitedClient.responses.create({ ... });
 *
 * // Access rate limiter stats
 * console.log(rateLimitedClient.rateLimiter.getStats());
 * ```
 */
export function withRateLimit<T extends object>(
    client: T,
    config: RateLimiterConfig = {},
    logger?: Logger
): T & RateLimitedClient<T> {
    const rateLimiter = new RateLimiter(config, logger);

    // Create a proxy that wraps async methods
    const createProxy = (target: any, path: string[] = []): any => {
        return new Proxy(target, {
            get(obj, prop: string | symbol) {
                // Handle special properties
                if (prop === 'rateLimiter') {
                    return rateLimiter;
                }
                if (prop === 'client') {
                    return client;
                }

                // Handle symbol properties (like Symbol.toStringTag)
                if (typeof prop === 'symbol') {
                    return obj[prop];
                }

                const value = obj[prop];

                // Skip undefined/null
                if (value === undefined || value === null) {
                    return value;
                }

                // Skip non-function properties and special properties
                if (typeof value !== 'function' && typeof value !== 'object') {
                    return value;
                }

                // Handle nested objects (like client.responses)
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    return createProxy(value, [...path, prop]);
                }

                // Wrap async functions that likely make API calls
                if (typeof value === 'function') {
                    // Only wrap methods that are likely API calls
                    const apiMethods = ['create', 'retrieve', 'update', 'delete', 'list'];
                    if (apiMethods.includes(prop)) {
                        return async (...args: any[]) => {
                            // Estimate tokens from the first argument (usually the request body)
                            const estimatedTokens = args[0] ? estimateTokens(args[0]) : 1000;

                            return rateLimiter.execute(
                                () => value.apply(obj, args),
                                estimatedTokens
                            );
                        };
                    }

                    // Return unmodified for other methods
                    return value.bind(obj);
                }

                return value;
            }
        });
    };

    return createProxy(client) as T & RateLimitedClient<T>;
}

export default RateLimiter;
