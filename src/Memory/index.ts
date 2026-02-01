/**
 * Memory system exports
 */

// Backends
export { InMemoryBackend } from './backends/InMemoryBackend';
export type { JSONFileBackendConfig } from './backends/JSONFileBackend';
export { JSONFileBackend } from './backends/JSONFileBackend';
// Main store
export { default, MemoryStore } from './MemoryStore';

// Types
export {
    createMemoryItem,
    estimateTokens,
    type MemoryBackend,
    MemoryEvent,
    type MemoryEventPayload,
    type MemoryItem,
    type MemoryQuery,
    type MemorySetOptions,
    type MemoryStoreConfig,
    scoreItemByKeywords,
} from './types';
