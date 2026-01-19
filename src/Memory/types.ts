/**
 * Memory system types for TinyCrew
 */

/**
 * Enhanced memory item with full metadata for querying and management
 */
export interface MemoryItem {
    /** Unique key for this memory entry */
    key: string;

    /** Task ID that generated this memory */
    taskId: string;

    /** Agent that created this memory */
    agent: string;

    /** Original task description */
    task: string;

    /** Full result content */
    result: string;

    /** Short summary of the result (for context injection) */
    summary?: string;

    /** Searchable tags */
    tags: string[];

    /** Capabilities used by the agent for this task */
    capabilitiesUsed: string[];

    /** Tools invoked during task execution */
    toolsUsed: string[];

    /** Creation timestamp (ms since epoch) */
    createdAt: number;

    /** Last update timestamp (ms since epoch) */
    updatedAt: number;

    /** Expiration timestamp (ms since epoch), undefined = never expires */
    expiresAt?: number;

    /** Estimated token count for the result */
    tokenCount: number;

    /** Number of times this memory has been accessed */
    accessCount: number;

    /** Last access timestamp (ms since epoch) */
    lastAccessedAt: number;

    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Query parameters for filtering memory items
 */
export interface MemoryQuery {
    /** Filter by agent name */
    agent?: string;

    /** Filter by tags (any match) */
    tags?: string[];

    /** Filter by keywords in task/result (any match) */
    keywords?: string[];

    /** Keywords to score against when sorting by relevance (improves context selection) */
    relevanceKeywords?: string[];

    /** Filter items created after this timestamp */
    after?: number;

    /** Filter items created before this timestamp */
    before?: number;

    /** Maximum number of items to return */
    maxItems?: number;

    /** Sort order for results */
    sortBy?: 'relevance' | 'recency' | 'accessCount';

    /** Include expired items (default: false) */
    includeExpired?: boolean;
}

/**
 * Options for creating/updating memory items
 */
export interface MemorySetOptions {
    /** Time-to-live in milliseconds (overrides default) */
    ttl?: number;

    /** Tags to associate with this memory */
    tags?: string[];

    /** Whether to merge with existing item if key exists */
    merge?: boolean;
}

/**
 * Configuration for MemoryStore
 */
export interface MemoryStoreConfig {
    /** Default TTL for new items (ms), undefined = never expires */
    defaultTtl?: number;

    /** Maximum number of items to store (triggers eviction) */
    maxItems?: number;

    /** Maximum total tokens across all items (triggers eviction) */
    maxTotalTokens?: number;

    /** Token count threshold for auto-summarization */
    summarizeThreshold?: number;

    /** Enable automatic eviction of expired items */
    autoEvict?: boolean;

    /** Interval for auto-eviction check (ms) */
    evictInterval?: number;
}

/**
 * Backend interface for pluggable storage implementations
 */
export interface MemoryBackend {
    /** Backend name for logging/debugging */
    readonly name: string;

    /**
     * Load all memory items for a crew
     */
    load(crewId: string): Promise<Map<string, MemoryItem>>;

    /**
     * Save all memory items for a crew (bulk write)
     */
    save(crewId: string, memory: Map<string, MemoryItem>): Promise<void>;

    /**
     * Get a single memory item by key
     */
    get(crewId: string, key: string): Promise<MemoryItem | null>;

    /**
     * Set a memory item
     */
    set(crewId: string, key: string, item: MemoryItem): Promise<void>;

    /**
     * Delete a memory item by key
     */
    delete(crewId: string, key: string): Promise<boolean>;

    /**
     * Query memory items with filters
     */
    query(crewId: string, filter: MemoryQuery): Promise<MemoryItem[]>;

    /**
     * Clear all memory for a crew
     */
    clear(crewId: string): Promise<void>;

    /**
     * Check if backend is ready/connected
     */
    isReady(): Promise<boolean>;

    /**
     * Close/cleanup backend resources
     */
    close(): Promise<void>;
}

/**
 * Memory events emitted by MemoryStore
 */
export enum MemoryEvent {
    ITEM_SET = 'memory:item_set',
    ITEM_GET = 'memory:item_get',
    ITEM_DELETED = 'memory:item_deleted',
    ITEMS_EVICTED = 'memory:items_evicted',
    MEMORY_LOADED = 'memory:loaded',
    MEMORY_SAVED = 'memory:saved',
    MEMORY_CLEARED = 'memory:cleared'
}

/**
 * Payload for memory events
 */
export interface MemoryEventPayload {
    crewId: string;
    timestamp: number;
    key?: string;
    item?: MemoryItem;
    count?: number;
    reason?: string;
}

/**
 * Helper to create a new MemoryItem with defaults
 */
export function createMemoryItem(
    partial: Pick<MemoryItem, 'key' | 'taskId' | 'agent' | 'task' | 'result'> &
        Partial<Omit<MemoryItem, 'key' | 'taskId' | 'agent' | 'task' | 'result'>>
): MemoryItem {
    const now = Date.now();
    return {
        key: partial.key,
        taskId: partial.taskId,
        agent: partial.agent,
        task: partial.task,
        result: partial.result,
        summary: partial.summary,
        tags: partial.tags ?? [],
        capabilitiesUsed: partial.capabilitiesUsed ?? [],
        toolsUsed: partial.toolsUsed ?? [],
        createdAt: partial.createdAt ?? now,
        updatedAt: partial.updatedAt ?? now,
        expiresAt: partial.expiresAt,
        tokenCount: partial.tokenCount ?? estimateTokens(partial.result),
        accessCount: partial.accessCount ?? 0,
        lastAccessedAt: partial.lastAccessedAt ?? now,
        metadata: partial.metadata
    };
}

/**
 * Simple token estimation (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Score a memory item by keyword relevance
 * Higher score = more relevant
 */
export function scoreItemByKeywords(item: MemoryItem, keywords: string[]): number {
    if (!keywords || keywords.length === 0) {
        return 0;
    }

    let score = 0;
    const lowerKeywords = keywords.map(k => k.toLowerCase());

    for (const keyword of lowerKeywords) {
        // Tags: +3 points for exact match (strong signal)
        if (item.tags.some(tag => tag.toLowerCase() === keyword)) {
            score += 3;
        }

        // Task description: +2 points for substring match
        if (item.task.toLowerCase().includes(keyword)) {
            score += 2;
        }

        // Result: +1 point for substring match
        if (item.result.toLowerCase().includes(keyword)) {
            score += 1;
        }

        // Tools used: +2 points for match
        if (item.toolsUsed.some(tool => tool.toLowerCase().includes(keyword))) {
            score += 2;
        }

        // Capabilities used: +2 points for match
        if (item.capabilitiesUsed.some(cap => cap.toLowerCase().includes(keyword))) {
            score += 2;
        }

        // Agent name: +1 point for match
        if (item.agent.toLowerCase().includes(keyword)) {
            score += 1;
        }
    }

    return score;
}
