/**
 * In-memory storage backend for MemoryStore
 * Default backend that stores all data in memory (no persistence)
 */

import type { MemoryBackend, MemoryItem, MemoryQuery } from '../types';
import { scoreItemByKeywords } from '../types';

export class InMemoryBackend implements MemoryBackend {
    readonly name = 'InMemory';

    /** Storage: crewId -> (key -> MemoryItem) */
    private storage: Map<string, Map<string, MemoryItem>> = new Map();

    async load(crewId: string): Promise<Map<string, MemoryItem>> {
        return this.getOrCreateCrewMemory(crewId);
    }

    async save(
        _crewId: string,
        _memory: Map<string, MemoryItem>,
    ): Promise<void> {
        // In-memory backend doesn't need explicit save - data is already in memory
        // This is a no-op for compatibility with the interface
    }

    async get(crewId: string, key: string): Promise<MemoryItem | null> {
        const crewMemory = this.storage.get(crewId);
        if (!crewMemory) return null;

        const item = crewMemory.get(key);
        if (!item) return null;

        // Check expiration
        if (item.expiresAt && item.expiresAt < Date.now()) {
            crewMemory.delete(key);
            return null;
        }

        return item;
    }

    async set(crewId: string, key: string, item: MemoryItem): Promise<void> {
        const crewMemory = this.getOrCreateCrewMemory(crewId);
        crewMemory.set(key, item);
    }

    async delete(crewId: string, key: string): Promise<boolean> {
        const crewMemory = this.storage.get(crewId);
        if (!crewMemory) return false;
        return crewMemory.delete(key);
    }

    async query(crewId: string, filter: MemoryQuery): Promise<MemoryItem[]> {
        const crewMemory = this.storage.get(crewId);
        if (!crewMemory) return [];

        const now = Date.now();
        let results: MemoryItem[] = [];

        for (const item of crewMemory.values()) {
            // Skip expired items unless explicitly requested
            if (
                !filter.includeExpired &&
                item.expiresAt &&
                item.expiresAt < now
            ) {
                continue;
            }

            // Apply filters
            if (!this.matchesFilter(item, filter)) {
                continue;
            }

            results.push(item);
        }

        // Sort results (pass relevanceKeywords for keyword-aware sorting)
        results = this.sortResults(
            results,
            filter.sortBy ?? 'recency',
            filter.relevanceKeywords,
        );

        // Limit results
        if (filter.maxItems && results.length > filter.maxItems) {
            results = results.slice(0, filter.maxItems);
        }

        return results;
    }

    async clear(crewId: string): Promise<void> {
        this.storage.delete(crewId);
    }

    async isReady(): Promise<boolean> {
        return true;
    }

    async close(): Promise<void> {
        this.storage.clear();
    }

    /**
     * Get or create memory map for a crew
     */
    private getOrCreateCrewMemory(crewId: string): Map<string, MemoryItem> {
        let crewMemory = this.storage.get(crewId);
        if (!crewMemory) {
            crewMemory = new Map();
            this.storage.set(crewId, crewMemory);
        }
        return crewMemory;
    }

    /**
     * Check if an item matches the query filter
     */
    private matchesFilter(item: MemoryItem, filter: MemoryQuery): boolean {
        // Filter by agent
        if (filter.agent && item.agent !== filter.agent) {
            return false;
        }

        // Filter by time range
        if (filter.after && item.createdAt < filter.after) {
            return false;
        }
        if (filter.before && item.createdAt > filter.before) {
            return false;
        }

        // Filter by tags (any match)
        if (filter.tags && filter.tags.length > 0) {
            const hasMatchingTag = filter.tags.some((tag) =>
                item.tags.includes(tag),
            );
            if (!hasMatchingTag) {
                return false;
            }
        }

        // Filter by keywords (any match in task or result)
        if (filter.keywords && filter.keywords.length > 0) {
            const searchText = `${item.task} ${item.result}`.toLowerCase();
            const hasMatchingKeyword = filter.keywords.some((keyword) =>
                searchText.includes(keyword.toLowerCase()),
            );
            if (!hasMatchingKeyword) {
                return false;
            }
        }

        return true;
    }

    /**
     * Sort results by the specified criteria
     * @param items - Items to sort
     * @param sortBy - Sort criteria
     * @param relevanceKeywords - Keywords to score against when sorting by relevance
     */
    private sortResults(
        items: MemoryItem[],
        sortBy: 'relevance' | 'recency' | 'accessCount',
        relevanceKeywords?: string[],
    ): MemoryItem[] {
        switch (sortBy) {
            case 'recency':
                return items.sort((a, b) => b.createdAt - a.createdAt);

            case 'accessCount':
                return items.sort((a, b) => b.accessCount - a.accessCount);

            case 'relevance':
                // Score by keyword matches + recency + access count
                return items.sort((a, b) => {
                    // Keyword score (if keywords provided)
                    const keywordScoreA = relevanceKeywords
                        ? scoreItemByKeywords(a, relevanceKeywords)
                        : 0;
                    const keywordScoreB = relevanceKeywords
                        ? scoreItemByKeywords(b, relevanceKeywords)
                        : 0;

                    // If keyword scores differ significantly, use that
                    if (Math.abs(keywordScoreA - keywordScoreB) >= 2) {
                        return keywordScoreB - keywordScoreA;
                    }

                    // Otherwise fall back to recency + access count
                    const baseScoreA = a.accessCount + a.createdAt / 1000000000;
                    const baseScoreB = b.accessCount + b.createdAt / 1000000000;

                    // Combine: keyword score weighted heavily + base score as tie-breaker
                    const totalA = keywordScoreA * 1000 + baseScoreA;
                    const totalB = keywordScoreB * 1000 + baseScoreB;
                    return totalB - totalA;
                });

            default:
                return items;
        }
    }

    /**
     * Get total item count across all crews (for testing/debugging)
     */
    getTotalItemCount(): number {
        let count = 0;
        for (const crewMemory of this.storage.values()) {
            count += crewMemory.size;
        }
        return count;
    }

    /**
     * Get crew IDs (for testing/debugging)
     */
    getCrewIds(): string[] {
        return Array.from(this.storage.keys());
    }
}

export default InMemoryBackend;
