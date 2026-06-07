/**
 * Eviction planning for MemoryStore.
 *
 * Pure logic that decides which memory keys should be removed, kept separate
 * from the I/O and event concerns of MemoryStore.
 */

import type { MemoryItem } from './types';

export interface EvictionLimits {
    maxTotalTokens: number;
    maxItems: number;
}

/** Lower score = evicted first. Favours frequently/recently accessed items. */
function evictionScore(item: MemoryItem): number {
    return item.accessCount * 1000 + item.lastAccessedAt / 1_000_000;
}

/**
 * Decide which keys to evict: first all expired items, then the lowest-priority
 * survivors until the store is back within its token and item limits.
 *
 * @returns the list of keys to delete (does not mutate the map)
 */
export function planEviction(
    memory: Map<string, MemoryItem>,
    limits: EvictionLimits,
    now: number,
): string[] {
    const expiredKeys: string[] = [];
    for (const [key, item] of memory) {
        if (item.expiresAt && item.expiresAt < now) {
            expiredKeys.push(key);
        }
    }

    const expired = new Set(expiredKeys);
    const survivors = [...memory.values()].filter(
        (item) => !expired.has(item.key),
    );

    let totalTokens = survivors.reduce((sum, item) => sum + item.tokenCount, 0);
    let count = survivors.length;

    const withinLimits =
        totalTokens <= limits.maxTotalTokens && count <= limits.maxItems;
    if (withinLimits) {
        return expiredKeys;
    }

    // Evict lowest-priority survivors until back under limits.
    const toDelete = [...expiredKeys];
    survivors.sort((a, b) => evictionScore(a) - evictionScore(b));

    for (const item of survivors) {
        if (count <= limits.maxItems && totalTokens <= limits.maxTotalTokens) {
            break;
        }
        toDelete.push(item.key);
        totalTokens -= item.tokenCount;
        count -= 1;
    }

    return toDelete;
}
