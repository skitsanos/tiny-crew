/**
 * JSON file storage backend for MemoryStore
 * Persists memory to JSON files with atomic writes
 */

import {
    access,
    mkdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MemoryBackend, MemoryItem, MemoryQuery } from '../types';
import { scoreItemByKeywords } from '../types';

export interface JSONFileBackendConfig {
    /** Directory to store memory files */
    basePath: string;

    /** File name pattern (default: '{crewId}.memory.json') */
    filePattern?: string;

    /** Pretty print JSON (default: false for smaller files) */
    prettyPrint?: boolean;

    /** Create directory if it doesn't exist (default: true) */
    createDir?: boolean;
}

interface MemoryFileData {
    version: number;
    crewId: string;
    updatedAt: number;
    items: Record<string, MemoryItem>;
}

const CURRENT_VERSION = 1;

export class JSONFileBackend implements MemoryBackend {
    readonly name = 'JSONFile';

    private readonly basePath: string;
    private readonly filePattern: string;
    private readonly prettyPrint: boolean;
    private readonly createDir: boolean;

    /** In-memory cache for loaded data */
    private cache: Map<string, Map<string, MemoryItem>> = new Map();

    /** Track which crews have pending changes */
    private dirty: Set<string> = new Set();

    constructor(config: JSONFileBackendConfig) {
        this.basePath = config.basePath;
        this.filePattern = config.filePattern ?? '{crewId}.memory.json';
        this.prettyPrint = config.prettyPrint ?? false;
        this.createDir = config.createDir ?? true;
    }

    async load(crewId: string): Promise<Map<string, MemoryItem>> {
        // Return cached data if available
        if (this.cache.has(crewId)) {
            return this.cache.get(crewId)!;
        }

        const filePath = this.getFilePath(crewId);

        try {
            const content = await readFile(filePath, 'utf-8');
            const data: MemoryFileData = JSON.parse(content);

            // Validate version
            if (data.version !== CURRENT_VERSION) {
                console.warn(
                    `Memory file version mismatch: expected ${CURRENT_VERSION}, got ${data.version}`,
                );
                // Future: implement migration logic here
            }

            // Convert to Map
            const memory = new Map<string, MemoryItem>();
            for (const [key, item] of Object.entries(data.items)) {
                memory.set(key, item);
            }

            this.cache.set(crewId, memory);
            return memory;
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, return empty map
                const memory = new Map<string, MemoryItem>();
                this.cache.set(crewId, memory);
                return memory;
            }
            throw error;
        }
    }

    async save(crewId: string, memory: Map<string, MemoryItem>): Promise<void> {
        const filePath = this.getFilePath(crewId);

        // Ensure directory exists
        if (this.createDir) {
            await mkdir(dirname(filePath), { recursive: true });
        }

        // Convert Map to plain object
        const items: Record<string, MemoryItem> = {};
        for (const [key, item] of memory) {
            items[key] = item;
        }

        const data: MemoryFileData = {
            version: CURRENT_VERSION,
            crewId,
            updatedAt: Date.now(),
            items,
        };

        const content = this.prettyPrint
            ? JSON.stringify(data, null, 2)
            : JSON.stringify(data);

        // Atomic write: write to temp file, then rename
        // rename() is atomic on POSIX filesystems, so a crash won't leave a partial target
        const tempPath = `${filePath}.tmp`;
        await writeFile(tempPath, content, 'utf-8');
        await rename(tempPath, filePath);

        // Update cache
        this.cache.set(crewId, memory);
        this.dirty.delete(crewId);
    }

    async get(crewId: string, key: string): Promise<MemoryItem | null> {
        const memory = await this.load(crewId);
        const item = memory.get(key);

        if (!item) return null;

        // Check expiration
        if (item.expiresAt && item.expiresAt < Date.now()) {
            memory.delete(key);
            this.dirty.add(crewId);
            return null;
        }

        return item;
    }

    async set(crewId: string, key: string, item: MemoryItem): Promise<void> {
        const memory = await this.load(crewId);
        memory.set(key, item);
        this.cache.set(crewId, memory);
        this.dirty.add(crewId);

        // Auto-save on set for durability
        await this.save(crewId, memory);
    }

    async delete(crewId: string, key: string): Promise<boolean> {
        const memory = await this.load(crewId);
        const existed = memory.delete(key);

        if (existed) {
            this.dirty.add(crewId);
            await this.save(crewId, memory);
        }

        return existed;
    }

    async query(crewId: string, filter: MemoryQuery): Promise<MemoryItem[]> {
        const memory = await this.load(crewId);
        const now = Date.now();
        let results: MemoryItem[] = [];

        for (const item of memory.values()) {
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
        const filePath = this.getFilePath(crewId);

        // Remove from cache
        this.cache.delete(crewId);
        this.dirty.delete(crewId);

        // Delete file
        try {
            await unlink(filePath);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }

    async isReady(): Promise<boolean> {
        try {
            if (this.createDir) {
                await mkdir(this.basePath, { recursive: true });
            }
            await access(this.basePath);
            return true;
        } catch {
            return false;
        }
    }

    async close(): Promise<void> {
        // Save any pending changes
        for (const crewId of this.dirty) {
            const memory = this.cache.get(crewId);
            if (memory) {
                await this.save(crewId, memory);
            }
        }

        this.cache.clear();
        this.dirty.clear();
    }

    /**
     * Flush all pending changes to disk
     */
    async flush(): Promise<void> {
        for (const crewId of this.dirty) {
            const memory = this.cache.get(crewId);
            if (memory) {
                await this.save(crewId, memory);
            }
        }
    }

    /**
     * Check if there are unsaved changes
     */
    hasPendingChanges(): boolean {
        return this.dirty.size > 0;
    }

    /**
     * Get the file path for a crew's memory
     */
    private getFilePath(crewId: string): string {
        const fileName = this.filePattern.replace('{crewId}', crewId);
        return join(this.basePath, fileName);
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
}

export default JSONFileBackend;
