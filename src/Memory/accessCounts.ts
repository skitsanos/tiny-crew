/**
 * Deferred access-count tracking for MemoryStore.
 *
 * Access counts are bumped in memory on every read and flushed to the backend
 * periodically to avoid disk churn. This tracker owns the pending ("dirty")
 * counts; persistence stays in MemoryStore where the backend lives.
 */

export interface AccessCount {
    accessCount: number;
    lastAccessedAt: number;
}

export class AccessCountTracker {
    private readonly dirty = new Map<string, Map<string, AccessCount>>();

    /** Pending count for an item, or null if none recorded */
    get(crewId: string, key: string): AccessCount | null {
        return this.dirty.get(crewId)?.get(key) ?? null;
    }

    /** Record a pending count for later flushing */
    mark(
        crewId: string,
        key: string,
        accessCount: number,
        lastAccessedAt: number,
    ): void {
        let crew = this.dirty.get(crewId);
        if (!crew) {
            crew = new Map();
            this.dirty.set(crewId, crew);
        }
        crew.set(key, { accessCount, lastAccessedAt });
    }

    /** Iterate pending counts per crew */
    entries(): IterableIterator<[string, Map<string, AccessCount>]> {
        return this.dirty.entries();
    }

    /** Drop all pending counts for a crew */
    clearCrew(crewId: string): void {
        this.dirty.delete(crewId);
    }
}
