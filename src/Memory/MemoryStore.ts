/**
 * MemoryStore - High-level memory management for TinyCrew
 * Wraps a backend and provides eviction, events, and convenience methods
 */

import EventEmitter from 'node:events';
import type Logger from '@tinycrew/utils/logger';
import { AccessCountTracker } from './accessCounts';
import { InMemoryBackend } from './backends/InMemoryBackend';
import { buildContextString } from './context';
import { planEviction } from './eviction';
import { computeStats, type MemoryStats } from './stats';
import type {
    MemoryBackend,
    MemoryEventPayload,
    MemoryItem,
    MemoryQuery,
    MemorySetOptions,
    MemoryStoreConfig,
} from './types';
import { createMemoryItem, MemoryEvent } from './types';

const DEFAULT_CONFIG: Required<MemoryStoreConfig> = {
    defaultTtl: 0, // 0 = never expires
    maxItems: 1000,
    maxTotalTokens: 100_000,
    summarizeThreshold: 2000,
    autoEvict: true,
    evictInterval: 60_000, // 1 minute
};

export class MemoryStore extends EventEmitter {
    private readonly backend: MemoryBackend;
    private readonly config: Required<MemoryStoreConfig>;
    private readonly logger?: Logger;
    private evictTimer?: Timer;

    /** Track active crew IDs for periodic eviction */
    private readonly activeCrews: Set<string> = new Set();

    /** Pending access counts, flushed to the backend periodically */
    private readonly accessCounts = new AccessCountTracker();

    constructor(
        backend?: MemoryBackend,
        config?: MemoryStoreConfig,
        logger?: Logger,
    ) {
        super();
        this.backend = backend ?? new InMemoryBackend();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.logger = logger;

        // Start auto-eviction if enabled
        if (this.config.autoEvict && this.config.evictInterval > 0) {
            this.startAutoEvict();
        }
    }

    /**
     * Get the backend name
     */
    get backendName(): string {
        return this.backend.name;
    }

    /**
     * Store a memory item
     */
    async set(
        crewId: string,
        key: string,
        data: {
            taskId: string;
            agent: string;
            task: string;
            result: string;
            toolsUsed?: string[];
            capabilitiesUsed?: string[];
            metadata?: Record<string, unknown>;
        },
        options?: MemorySetOptions,
    ): Promise<MemoryItem> {
        const now = Date.now();

        // Check for existing item if merge is requested
        let existing: MemoryItem | null = null;
        if (options?.merge) {
            existing = await this.backend.get(crewId, key);
        }

        // Calculate expiration
        const ttl = options?.ttl ?? this.config.defaultTtl;
        const expiresAt = ttl > 0 ? now + ttl : undefined;

        // Create or update item
        const item = createMemoryItem({
            key,
            taskId: data.taskId,
            agent: data.agent,
            task: data.task,
            result: data.result,
            toolsUsed: data.toolsUsed ?? [],
            capabilitiesUsed: data.capabilitiesUsed ?? [],
            tags: options?.tags ?? existing?.tags ?? [],
            metadata: data.metadata ?? existing?.metadata,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            expiresAt,
            accessCount: existing?.accessCount ?? 0,
            lastAccessedAt: existing?.lastAccessedAt ?? now,
        });

        // Store the item
        await this.backend.set(crewId, key, item);

        // Track this crew as active for periodic eviction
        this.activeCrews.add(crewId);

        this.logger?.debug(`Memory set: ${key}`, { crewId, agent: data.agent });

        // Emit event
        this.emitEvent(MemoryEvent.ITEM_SET, { crewId, key, item });

        // Check if eviction is needed
        await this.maybeEvict(crewId);

        return item;
    }

    /**
     * Get a memory item by key
     * Note: Access counts are updated in-memory and flushed periodically to avoid disk churn
     */
    async get(crewId: string, key: string): Promise<MemoryItem | null> {
        const backendItem = await this.backend.get(crewId, key);

        if (!backendItem) {
            return null;
        }

        // Track this crew as active for periodic eviction
        this.activeCrews.add(crewId);

        // Clone the item to avoid mutating the backend's cached object
        const item: MemoryItem = {
            ...backendItem,
            tags: [...backendItem.tags],
        };

        // Apply any pending dirty access count first
        const dirtyCount = this.accessCounts.get(crewId, key);
        if (dirtyCount) {
            item.accessCount = dirtyCount.accessCount;
            item.lastAccessedAt = dirtyCount.lastAccessedAt;
        }

        // Update access tracking in-memory only (defer persistence)
        item.accessCount++;
        item.lastAccessedAt = Date.now();
        this.accessCounts.mark(
            crewId,
            key,
            item.accessCount,
            item.lastAccessedAt,
        );

        this.emitEvent(MemoryEvent.ITEM_GET, { crewId, key, item });

        return item;
    }

    /**
     * Flush dirty access counts to backend
     */
    async flushAccessCounts(): Promise<number> {
        let flushedCount = 0;

        for (const [crewId, dirtyItems] of this.accessCounts.entries()) {
            if (dirtyItems.size === 0) continue;

            const memory = await this.backend.load(crewId);
            let modified = false;

            for (const [key, counts] of dirtyItems) {
                const item = memory.get(key);
                if (item) {
                    item.accessCount = counts.accessCount;
                    item.lastAccessedAt = counts.lastAccessedAt;
                    modified = true;
                    flushedCount++;
                }
            }

            if (modified) {
                await this.backend.save(crewId, memory);
            }

            dirtyItems.clear();
        }

        if (flushedCount > 0) {
            this.logger?.debug(`Flushed ${flushedCount} dirty access counts`);
        }

        return flushedCount;
    }

    /**
     * Delete a memory item
     */
    async delete(crewId: string, key: string): Promise<boolean> {
        const deleted = await this.backend.delete(crewId, key);

        if (deleted) {
            this.logger?.debug(`Memory deleted: ${key}`, { crewId });
            this.emitEvent(MemoryEvent.ITEM_DELETED, { crewId, key });
        }

        return deleted;
    }

    /**
     * Query memory items
     */
    async query(crewId: string, filter: MemoryQuery): Promise<MemoryItem[]> {
        return this.backend.query(crewId, filter);
    }

    /**
     * Load all memory for a crew
     */
    async load(crewId: string): Promise<Map<string, MemoryItem>> {
        const memory = await this.backend.load(crewId);

        // Track this crew as active for periodic eviction if it has items
        if (memory.size > 0) {
            this.activeCrews.add(crewId);
        }

        this.emitEvent(MemoryEvent.MEMORY_LOADED, {
            crewId,
            count: memory.size,
        });
        return memory;
    }

    /**
     * Save all memory for a crew
     */
    async save(crewId: string): Promise<void> {
        const memory = await this.backend.load(crewId);
        await this.backend.save(crewId, memory);
        this.emitEvent(MemoryEvent.MEMORY_SAVED, {
            crewId,
            count: memory.size,
        });
    }

    /**
     * Clear all memory for a crew
     */
    async clear(crewId: string): Promise<void> {
        await this.backend.clear(crewId);
        // Clear any dirty access counts for this crew
        this.accessCounts.clearCrew(crewId);
        this.activeCrews.delete(crewId);
        this.logger?.info(`Memory cleared for crew: ${crewId}`);
        this.emitEvent(MemoryEvent.MEMORY_CLEARED, { crewId });
    }

    /**
     * Get memory statistics for a crew
     */
    async getStats(crewId: string): Promise<MemoryStats> {
        const memory = await this.backend.load(crewId);
        return computeStats(memory);
    }

    /**
     * Build context string for prompt injection
     * Returns memory items formatted for LLM context
     * @param crewId - Crew ID to build context for
     * @param options - Configuration options
     * @param options.maxTokens - Maximum tokens for context (default: 4000)
     * @param options.maxItems - Maximum items to include (default: 20)
     * @param options.filter - Additional query filters
     * @param options.includeTimestamps - Include timestamps in context (default: true)
     * @param options.relevanceKeywords - Keywords for relevance scoring (e.g., from current task)
     */
    async buildContext(
        crewId: string,
        options?: {
            maxTokens?: number;
            maxItems?: number;
            filter?: MemoryQuery;
            includeTimestamps?: boolean;
            relevanceKeywords?: string[];
        },
    ): Promise<string> {
        const maxItems = options?.maxItems ?? 20;

        // Query relevant items (pass relevanceKeywords for scoring)
        const items = await this.query(crewId, {
            ...options?.filter,
            maxItems,
            sortBy: 'relevance',
            relevanceKeywords: options?.relevanceKeywords,
        });

        return buildContextString(items, {
            maxTokens: options?.maxTokens ?? 4000,
            includeTimestamps: options?.includeTimestamps ?? true,
            summarizeThreshold: this.config.summarizeThreshold,
        });
    }

    /**
     * Evict items to stay within limits
     */
    async evict(crewId: string): Promise<number> {
        const memory = await this.backend.load(crewId);
        const toDelete = planEviction(memory, this.config, Date.now());

        if (toDelete.length === 0) {
            return 0;
        }

        for (const key of toDelete) {
            memory.delete(key);
        }

        await this.backend.save(crewId, memory);
        this.logger?.info(`Evicted ${toDelete.length} memory items`, {
            crewId,
        });
        this.emitEvent(MemoryEvent.ITEMS_EVICTED, {
            crewId,
            count: toDelete.length,
            reason: 'limits_exceeded',
        });

        return toDelete.length;
    }

    /**
     * Check if eviction is needed and perform if necessary
     */
    private async maybeEvict(crewId: string): Promise<void> {
        if (!this.config.autoEvict) return;

        const stats = await this.getStats(crewId);

        if (
            stats.itemCount > this.config.maxItems ||
            stats.totalTokens > this.config.maxTotalTokens
        ) {
            await this.evict(crewId);
        }
    }

    /**
     * Start auto-eviction timer
     * Periodically evicts expired items from active crews and flushes dirty access counts
     */
    private startAutoEvict(): void {
        this.evictTimer = setInterval(async () => {
            try {
                // Flush dirty access counts first
                await this.flushAccessCounts();

                // Run eviction on all active crews
                for (const crewId of this.activeCrews) {
                    await this.evict(crewId);
                }
            } catch (error) {
                this.logger?.warn('Auto-eviction cycle failed:', error);
            }
        }, this.config.evictInterval);
    }

    /**
     * Stop auto-eviction timer
     */
    stopAutoEvict(): void {
        if (this.evictTimer) {
            clearInterval(this.evictTimer);
            this.evictTimer = undefined;
        }
    }

    /**
     * Close the memory store and backend
     * Flushes any pending access counts before closing
     */
    async close(): Promise<void> {
        this.stopAutoEvict();
        // Flush dirty access counts before closing
        await this.flushAccessCounts();
        await this.backend.close();
    }

    /**
     * Check if backend is ready
     */
    async isReady(): Promise<boolean> {
        return this.backend.isReady();
    }

    /**
     * Emit a typed memory event
     */
    private emitEvent(
        event: MemoryEvent,
        payload: Partial<MemoryEventPayload>,
    ): void {
        this.emit(event, {
            timestamp: Date.now(),
            ...payload,
        } as MemoryEventPayload);
    }
}

export default MemoryStore;
