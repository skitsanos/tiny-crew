import type Logger from '@/utils/logger.ts';

export interface RetryOptions {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
    shouldRetry?: (error: unknown) => boolean;
}

const defaultShouldRetry = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') {
        return true;
    }

    const status = (error as { status?: number }).status;
    if (typeof status === 'number') {
        if (status >= 500 || status === 408 || status === 429) {
            return true;
        }
        return false;
    }

    return true;
};

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
    operation: () => Promise<T>,
    logger?: Logger,
    description: string = 'operation',
    options: RetryOptions = {},
): Promise<T> {
    const {
        maxAttempts = 3,
        initialDelayMs = 500,
        backoffFactor = 2,
        shouldRetry = defaultShouldRetry,
    } = options;

    let attempt = 0;
    let delay = initialDelayMs;
    let lastError: unknown;

    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            const retryable = shouldRetry(error);

            if (!retryable || attempt >= maxAttempts) {
                throw error;
            }

            logger?.warn(`${description} failed, retrying`, {
                attempt,
                maxAttempts,
                nextDelayMs: delay,
                error: error instanceof Error ? error.message : String(error),
            });

            await sleep(delay);
            delay *= backoffFactor;
        }
    }

    throw (
        lastError ??
        new Error(`${description} failed after ${maxAttempts} attempts`)
    );
}
