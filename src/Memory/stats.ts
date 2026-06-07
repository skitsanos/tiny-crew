/**
 * Statistics helpers for MemoryStore.
 */

import type { MemoryItem } from './types';

export interface MemoryStats {
    itemCount: number;
    totalTokens: number;
    oldestItem: number | null;
    newestItem: number | null;
    agentCounts: Record<string, number>;
}

/** Aggregate per-crew statistics from a memory map */
export function computeStats(memory: Map<string, MemoryItem>): MemoryStats {
    let totalTokens = 0;
    let oldestItem: number | null = null;
    let newestItem: number | null = null;
    const agentCounts: Record<string, number> = {};

    for (const item of memory.values()) {
        totalTokens += item.tokenCount;

        if (oldestItem === null || item.createdAt < oldestItem) {
            oldestItem = item.createdAt;
        }
        if (newestItem === null || item.createdAt > newestItem) {
            newestItem = item.createdAt;
        }

        agentCounts[item.agent] = (agentCounts[item.agent] ?? 0) + 1;
    }

    return {
        itemCount: memory.size,
        totalTokens,
        oldestItem,
        newestItem,
        agentCounts,
    };
}
