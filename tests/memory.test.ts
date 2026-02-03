import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createMemoryItem,
    estimateTokens,
    InMemoryBackend,
    JSONFileBackend,
    MemoryEvent,
    MemoryStore,
} from '@tinycrew/Memory';

describe('Memory System', () => {
    const testCrewId = 'test-crew-123';

    describe('InMemoryBackend', () => {
        let backend: InMemoryBackend;

        beforeEach(() => {
            backend = new InMemoryBackend();
        });

        it('has correct name', () => {
            expect(backend.name).toBe('InMemory');
        });

        it('returns empty map for new crew', async () => {
            const memory = await backend.load(testCrewId);
            expect(memory.size).toBe(0);
        });

        it('stores and retrieves items', async () => {
            const item = createMemoryItem({
                key: 'test-key',
                taskId: 'task-1',
                agent: 'TestAgent',
                task: 'Test task description',
                result: 'Test result',
            });

            await backend.set(testCrewId, 'test-key', item);

            const retrieved = await backend.get(testCrewId, 'test-key');
            expect(retrieved).not.toBeNull();
            expect(retrieved?.key).toBe('test-key');
            expect(retrieved?.agent).toBe('TestAgent');
            expect(retrieved?.result).toBe('Test result');
        });

        it('deletes items', async () => {
            const item = createMemoryItem({
                key: 'delete-me',
                taskId: 'task-1',
                agent: 'TestAgent',
                task: 'Test task',
                result: 'Test result',
            });

            await backend.set(testCrewId, 'delete-me', item);
            expect(await backend.get(testCrewId, 'delete-me')).not.toBeNull();

            const deleted = await backend.delete(testCrewId, 'delete-me');
            expect(deleted).toBe(true);
            expect(await backend.get(testCrewId, 'delete-me')).toBeNull();
        });

        it('returns false when deleting non-existent item', async () => {
            const deleted = await backend.delete(testCrewId, 'non-existent');
            expect(deleted).toBe(false);
        });

        it('handles expired items', async () => {
            const expiredItem = createMemoryItem({
                key: 'expired',
                taskId: 'task-1',
                agent: 'TestAgent',
                task: 'Expired task',
                result: 'Expired result',
                expiresAt: Date.now() - 1000, // Expired 1 second ago
            });

            await backend.set(testCrewId, 'expired', expiredItem);

            // Should return null for expired items
            const retrieved = await backend.get(testCrewId, 'expired');
            expect(retrieved).toBeNull();
        });

        it('queries items by agent', async () => {
            await backend.set(
                testCrewId,
                'item1',
                createMemoryItem({
                    key: 'item1',
                    taskId: 'task-1',
                    agent: 'AgentA',
                    task: 'Task 1',
                    result: 'Result 1',
                }),
            );

            await backend.set(
                testCrewId,
                'item2',
                createMemoryItem({
                    key: 'item2',
                    taskId: 'task-2',
                    agent: 'AgentB',
                    task: 'Task 2',
                    result: 'Result 2',
                }),
            );

            await backend.set(
                testCrewId,
                'item3',
                createMemoryItem({
                    key: 'item3',
                    taskId: 'task-3',
                    agent: 'AgentA',
                    task: 'Task 3',
                    result: 'Result 3',
                }),
            );

            const results = await backend.query(testCrewId, {
                agent: 'AgentA',
            });
            expect(results.length).toBe(2);
            expect(results.every((item) => item.agent === 'AgentA')).toBe(true);
        });

        it('queries items by tags', async () => {
            await backend.set(
                testCrewId,
                'tagged1',
                createMemoryItem({
                    key: 'tagged1',
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Task',
                    result: 'Result',
                    tags: ['important', 'research'],
                }),
            );

            await backend.set(
                testCrewId,
                'tagged2',
                createMemoryItem({
                    key: 'tagged2',
                    taskId: 'task-2',
                    agent: 'Agent',
                    task: 'Task',
                    result: 'Result',
                    tags: ['research'],
                }),
            );

            await backend.set(
                testCrewId,
                'untagged',
                createMemoryItem({
                    key: 'untagged',
                    taskId: 'task-3',
                    agent: 'Agent',
                    task: 'Task',
                    result: 'Result',
                }),
            );

            const results = await backend.query(testCrewId, {
                tags: ['important'],
            });
            expect(results.length).toBe(1);
            expect(results[0].key).toBe('tagged1');
        });

        it('queries items by keywords', async () => {
            await backend.set(
                testCrewId,
                'k1',
                createMemoryItem({
                    key: 'k1',
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Research AI advancements',
                    result: 'Found new breakthroughs in machine learning',
                }),
            );

            await backend.set(
                testCrewId,
                'k2',
                createMemoryItem({
                    key: 'k2',
                    taskId: 'task-2',
                    agent: 'Agent',
                    task: 'Write documentation',
                    result: 'Created user guide',
                }),
            );

            const results = await backend.query(testCrewId, {
                keywords: ['machine', 'learning'],
            });
            expect(results.length).toBe(1);
            expect(results[0].key).toBe('k1');
        });

        it('limits query results', async () => {
            for (let i = 0; i < 10; i++) {
                await backend.set(
                    testCrewId,
                    `item${i}`,
                    createMemoryItem({
                        key: `item${i}`,
                        taskId: `task-${i}`,
                        agent: 'Agent',
                        task: `Task ${i}`,
                        result: `Result ${i}`,
                    }),
                );
            }

            const results = await backend.query(testCrewId, { maxItems: 5 });
            expect(results.length).toBe(5);
        });

        it('clears all items for a crew', async () => {
            await backend.set(
                testCrewId,
                'item1',
                createMemoryItem({
                    key: 'item1',
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Task',
                    result: 'Result',
                }),
            );

            await backend.clear(testCrewId);

            const memory = await backend.load(testCrewId);
            expect(memory.size).toBe(0);
        });

        it('isolates memory between crews', async () => {
            await backend.set(
                'crew-a',
                'item',
                createMemoryItem({
                    key: 'item',
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Task A',
                    result: 'Result A',
                }),
            );

            await backend.set(
                'crew-b',
                'item',
                createMemoryItem({
                    key: 'item',
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Task B',
                    result: 'Result B',
                }),
            );

            const itemA = await backend.get('crew-a', 'item');
            const itemB = await backend.get('crew-b', 'item');

            expect(itemA?.result).toBe('Result A');
            expect(itemB?.result).toBe('Result B');
        });

        it('is always ready', async () => {
            expect(await backend.isReady()).toBe(true);
        });
    });

    describe('JSONFileBackend', () => {
        let backend: JSONFileBackend;
        let tempDir: string;

        beforeAll(() => {
            tempDir = mkdtempSync(join(tmpdir(), 'tiny-crew-memory-'));
        });

        afterAll(() => {
            rmSync(tempDir, { recursive: true, force: true });
        });

        beforeEach(() => {
            backend = new JSONFileBackend({ basePath: tempDir });
        });

        afterEach(async () => {
            await backend.close();
        });

        it('has correct name', () => {
            expect(backend.name).toBe('JSONFile');
        });

        it('persists and loads items', async () => {
            const item = createMemoryItem({
                key: 'persist-test',
                taskId: 'task-1',
                agent: 'TestAgent',
                task: 'Persistent task',
                result: 'Persistent result',
            });

            await backend.set(testCrewId, 'persist-test', item);

            // Create a new backend instance to verify persistence
            const newBackend = new JSONFileBackend({ basePath: tempDir });
            const retrieved = await newBackend.get(testCrewId, 'persist-test');

            expect(retrieved).not.toBeNull();
            expect(retrieved?.result).toBe('Persistent result');

            await newBackend.close();
        });

        it('returns empty map for non-existent file', async () => {
            const memory = await backend.load('non-existent-crew');
            expect(memory.size).toBe(0);
        });

        it('is ready after directory creation', async () => {
            expect(await backend.isReady()).toBe(true);
        });

        it('handles flush correctly', async () => {
            const item = createMemoryItem({
                key: 'flush-test',
                taskId: 'task-1',
                agent: 'Agent',
                task: 'Task',
                result: 'Result',
            });

            await backend.set('flush-crew', 'flush-test', item);
            await backend.flush();

            expect(backend.hasPendingChanges()).toBe(false);
        });
    });

    describe('MemoryStore', () => {
        let store: MemoryStore;

        beforeEach(() => {
            store = new MemoryStore(new InMemoryBackend(), {
                maxItems: 100,
                maxTotalTokens: 10000,
                autoEvict: false,
            });
        });

        afterEach(async () => {
            await store.close();
        });

        it('returns backend name', () => {
            expect(store.backendName).toBe('InMemory');
        });

        it('stores and retrieves items', async () => {
            const item = await store.set(testCrewId, 'store-test', {
                taskId: 'task-1',
                agent: 'StoreAgent',
                task: 'Store task',
                result: 'Store result',
            });

            expect(item.key).toBe('store-test');
            expect(item.agent).toBe('StoreAgent');

            const retrieved = await store.get(testCrewId, 'store-test');
            expect(retrieved?.result).toBe('Store result');
        });

        it('tracks access count on get', async () => {
            await store.set(testCrewId, 'access-test', {
                taskId: 'task-1',
                agent: 'Agent',
                task: 'Task',
                result: 'Result',
            });

            const item1 = await store.get(testCrewId, 'access-test');
            expect(item1?.accessCount).toBe(1);

            const item2 = await store.get(testCrewId, 'access-test');
            expect(item2?.accessCount).toBe(2);
        });

        it('emits events', async () => {
            const events: string[] = [];

            store.on(MemoryEvent.ITEM_SET, () => events.push('set'));
            store.on(MemoryEvent.ITEM_GET, () => events.push('get'));
            store.on(MemoryEvent.ITEM_DELETED, () => events.push('deleted'));

            await store.set(testCrewId, 'event-test', {
                taskId: 'task-1',
                agent: 'Agent',
                task: 'Task',
                result: 'Result',
            });

            await store.get(testCrewId, 'event-test');
            await store.delete(testCrewId, 'event-test');

            expect(events).toContain('set');
            expect(events).toContain('get');
            expect(events).toContain('deleted');
        });

        it('queries items', async () => {
            await store.set(testCrewId, 'q1', {
                taskId: 'task-1',
                agent: 'QueryAgent',
                task: 'Query task 1',
                result: 'Result 1',
            });

            await store.set(testCrewId, 'q2', {
                taskId: 'task-2',
                agent: 'QueryAgent',
                task: 'Query task 2',
                result: 'Result 2',
            });

            await store.set(testCrewId, 'q3', {
                taskId: 'task-3',
                agent: 'OtherAgent',
                task: 'Other task',
                result: 'Other result',
            });

            const results = await store.query(testCrewId, {
                agent: 'QueryAgent',
            });
            expect(results.length).toBe(2);
        });

        it('returns stats', async () => {
            await store.set(testCrewId, 's1', {
                taskId: 'task-1',
                agent: 'AgentX',
                task: 'Task 1',
                result: 'Result 1',
            });

            await store.set(testCrewId, 's2', {
                taskId: 'task-2',
                agent: 'AgentX',
                task: 'Task 2',
                result: 'Result 2',
            });

            await store.set(testCrewId, 's3', {
                taskId: 'task-3',
                agent: 'AgentY',
                task: 'Task 3',
                result: 'Result 3',
            });

            const stats = await store.getStats(testCrewId);
            expect(stats.itemCount).toBe(3);
            expect(stats.agentCounts.AgentX).toBe(2);
            expect(stats.agentCounts.AgentY).toBe(1);
            expect(stats.totalTokens).toBeGreaterThan(0);
        });

        it('builds context string', async () => {
            await store.set(testCrewId, 'ctx1', {
                taskId: 'task-1',
                agent: 'ContextAgent',
                task: 'Research AI trends',
                result: 'Found several emerging trends in artificial intelligence',
            });

            const context = await store.buildContext(testCrewId, {
                maxTokens: 1000,
            });

            expect(context).toContain('Previous Task Results');
            expect(context).toContain('ContextAgent');
            expect(context).toContain('Research AI trends');
        });

        it('evicts items when over limits', async () => {
            const limitedStore = new MemoryStore(new InMemoryBackend(), {
                maxItems: 3,
                autoEvict: true,
            });

            // Add 5 items
            for (let i = 0; i < 5; i++) {
                await limitedStore.set(testCrewId, `evict${i}`, {
                    taskId: `task-${i}`,
                    agent: 'Agent',
                    task: `Task ${i}`,
                    result: `Result ${i}`,
                });
            }

            const stats = await limitedStore.getStats(testCrewId);
            expect(stats.itemCount).toBeLessThanOrEqual(3);

            await limitedStore.close();
        });

        it('clears memory', async () => {
            await store.set(testCrewId, 'clear1', {
                taskId: 'task-1',
                agent: 'Agent',
                task: 'Task',
                result: 'Result',
            });

            await store.clear(testCrewId);

            const stats = await store.getStats(testCrewId);
            expect(stats.itemCount).toBe(0);
        });

        it('merges items when merge option is set', async () => {
            const item1 = await store.set(
                testCrewId,
                'merge-test',
                {
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Initial task',
                    result: 'Initial result',
                },
                { tags: ['original'] },
            );

            const item2 = await store.set(
                testCrewId,
                'merge-test',
                {
                    taskId: 'task-1',
                    agent: 'Agent',
                    task: 'Updated task',
                    result: 'Updated result',
                },
                { merge: true },
            );

            // Merged item should preserve original tags
            expect(item2.tags).toContain('original');
            expect(item2.result).toBe('Updated result');
            expect(item2.createdAt).toBe(item1.createdAt);
        });

        it('defers access count persistence until flush', async () => {
            // Use JSONFileBackend to verify deferred writes
            const backend = new JSONFileBackend({
                basePath: mkdtempSync(join(tmpdir(), 'tiny-crew-flush-')),
                createDir: true,
            });

            const flushStore = new MemoryStore(backend, { autoEvict: false });

            await flushStore.set(testCrewId, 'flush-test', {
                taskId: 'task-1',
                agent: 'Agent',
                task: 'Task',
                result: 'Result',
            });

            // Multiple reads should not trigger multiple writes
            const item1 = await flushStore.get(testCrewId, 'flush-test');
            const item2 = await flushStore.get(testCrewId, 'flush-test');
            const item3 = await flushStore.get(testCrewId, 'flush-test');

            expect(item1?.accessCount).toBe(1);
            expect(item2?.accessCount).toBe(2);
            expect(item3?.accessCount).toBe(3);

            // Flush the access counts
            const flushedCount = await flushStore.flushAccessCounts();
            expect(flushedCount).toBe(1); // One item was dirty

            // Verify access count is persisted after flush
            const newBackend = new JSONFileBackend({
                basePath: backend.basePath,
                createDir: false,
            });
            const newStore = new MemoryStore(newBackend, { autoEvict: false });
            const reloadedItem = await newStore.get(testCrewId, 'flush-test');

            // Should be 4 now (3 from before + 1 from this get)
            expect(reloadedItem?.accessCount).toBe(4);

            await flushStore.close();
            await newStore.close();
        });
    });

    describe('Helper Functions', () => {
        it('createMemoryItem generates valid items', () => {
            const item = createMemoryItem({
                key: 'helper-test',
                taskId: 'task-123',
                agent: 'HelperAgent',
                task: 'Test task',
                result: 'Test result',
            });

            expect(item.key).toBe('helper-test');
            expect(item.taskId).toBe('task-123');
            expect(item.agent).toBe('HelperAgent');
            expect(item.tokenCount).toBeGreaterThan(0);
            expect(item.createdAt).toBeGreaterThan(0);
            expect(item.accessCount).toBe(0);
            expect(item.tags).toEqual([]);
        });

        it('estimateTokens returns reasonable estimates', () => {
            const shortText = 'Hello world';
            const longText =
                'This is a longer text that should have more tokens. '.repeat(
                    10,
                );

            const shortTokens = estimateTokens(shortText);
            const longTokens = estimateTokens(longText);

            expect(shortTokens).toBeGreaterThan(0);
            expect(longTokens).toBeGreaterThan(shortTokens);
        });
    });
});
