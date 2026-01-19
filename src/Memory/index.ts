/**
 * Memory system exports
 */

// Main store
export { MemoryStore } from './MemoryStore';
export { default } from './MemoryStore';

// Backends
export { InMemoryBackend } from './backends/InMemoryBackend';
export { JSONFileBackend } from './backends/JSONFileBackend';
export type { JSONFileBackendConfig } from './backends/JSONFileBackend';

// Types
export {
    type MemoryItem,
    type MemoryQuery,
    type MemorySetOptions,
    type MemoryStoreConfig,
    type MemoryBackend,
    type MemoryEventPayload,
    MemoryEvent,
    createMemoryItem,
    estimateTokens,
    scoreItemByKeywords
} from './types';
