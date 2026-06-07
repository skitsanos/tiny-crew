/**
 * withRateLimit - transparent rate-limiting proxy for OpenAI-style clients.
 */

import type Logger from './logger';
import {
    estimateTokens,
    RateLimiter,
    type RateLimiterConfig,
} from './rateLimiter';

/**
 * Rate-limited client interface
 */
export interface RateLimitedClient<T> {
    /** The rate limiter instance for stats and control */
    rateLimiter: RateLimiter;
    /** The wrapped client */
    client: T;
}

/** Methods that are treated as API calls and routed through the limiter */
const API_METHODS = ['create', 'retrieve', 'update', 'delete', 'list'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Wrap an API method so calls flow through the rate limiter */
function wrapApiMethod(
    fn: (...args: any[]) => any,
    thisArg: any,
    rateLimiter: RateLimiter,
): (...args: any[]) => Promise<any> {
    return async (...args: any[]) => {
        // Estimate tokens from the first argument (usually the request body)
        const estimatedTokens = args[0] ? estimateTokens(args[0]) : 1000;
        return rateLimiter.execute(
            () => fn.apply(thisArg, args),
            estimatedTokens,
        );
    };
}

interface ProxyContext {
    rateLimiter: RateLimiter;
    client: unknown;
    createProxy: (target: any) => any;
}

/** Resolve a single proxied property access (hoisted to keep nesting shallow) */
function resolveProxyProperty(
    obj: any,
    prop: string | symbol,
    ctx: ProxyContext,
): any {
    if (prop === 'rateLimiter') return ctx.rateLimiter;
    if (prop === 'client') return ctx.client;
    if (typeof prop === 'symbol') return obj[prop];

    const value = obj[prop];
    if (value === undefined || value === null) return value;

    // Recurse into nested namespaces (e.g. client.responses)
    if (isPlainObject(value)) return ctx.createProxy(value);

    if (typeof value === 'function') {
        return API_METHODS.includes(prop)
            ? wrapApiMethod(value, obj, ctx.rateLimiter)
            : value.bind(obj);
    }

    return value;
}

/**
 * Create a rate-limited wrapper for an OpenAI client.
 *
 * @example
 * ```typescript
 * const client = new OpenAI();
 * const rateLimitedClient = withRateLimit(client, {
 *     requestsPerMinute: 60,
 *     tokensPerMinute: 100_000
 * });
 *
 * const response = await rateLimitedClient.responses.create({ ... });
 * console.log(rateLimitedClient.rateLimiter.getStats());
 * ```
 */
export function withRateLimit<T extends object>(
    client: T,
    config: RateLimiterConfig = {},
    logger?: Logger,
): T & RateLimitedClient<T> {
    const rateLimiter = new RateLimiter(config, logger);

    const createProxy = (target: any): any => {
        const ctx: ProxyContext = { rateLimiter, client, createProxy };
        return new Proxy(target, {
            get: (obj, prop: string | symbol) =>
                resolveProxyProperty(obj, prop, ctx),
        });
    };

    return createProxy(client) as T & RateLimitedClient<T>;
}
