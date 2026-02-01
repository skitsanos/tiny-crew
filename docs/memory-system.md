# Memory System

TinyCrew features a pluggable memory system that enables knowledge sharing between agents with optional persistence across sessions.

## Overview

The memory system is what allows multiple agents to build on each other's work. When an agent completes a task, its results are automatically stored in shared memory. When a new task is assigned, the agent receives the current state of shared memory, enabling effective collaboration.

## Architecture

The memory system consists of three main components:

### 1. MemoryStore

High-level API for storing and retrieving task results with:
- Automatic eviction based on size/token limits
- Event notifications for monitoring
- Context building for LLM prompts
- Keyword-aware relevance scoring

### 2. Backends

Pluggable storage implementations:

| Backend | Description | Use Case |
|---------|-------------|----------|
| `InMemoryBackend` | Fast, ephemeral storage | Development, single-session workflows |
| `JSONFileBackend` | File-based persistence with atomic writes | Production, multi-session workflows |

### 3. MemoryItem

Each stored item contains:
- Task description and result
- Agent attribution and timestamps
- Token count estimation
- Access tracking for relevance scoring
- Optional tags and metadata

## Basic Usage

```typescript
import { Crew } from 'tiny-crew';
import { MemoryStore, JSONFileBackend } from 'tiny-crew/Memory';
import OpenAI from 'openai';

// Create a persistent memory store
const memoryBackend = new JSONFileBackend({ basePath: './data/memory' });

// Create crew with memory options
const crew = new Crew(
    { goal: 'Research and analyze topics' },
    new OpenAI(),
    [],  // chatHistory
    {
        memoryBackend,
        memoryConfig: {
            maxItems: 500,
            maxTotalTokens: 50000,
            autoEvict: true
        }
    }
);

// Add agents and execute tasks...
// Task results are automatically stored in memory
```

## Configuration Options

```typescript
const memoryStore = new MemoryStore(backend, {
    defaultTtl: 0,            // Time-to-live in ms (0 = never expires)
    maxItems: 1000,           // Maximum items before eviction
    maxTotalTokens: 100000,   // Token budget for all items
    summarizeThreshold: 2000, // Token count to trigger summarization
    autoEvict: true,          // Enable automatic eviction
    evictInterval: 60000      // Eviction check interval (ms)
});
```

## Keyword-Aware Relevance

When building context for agents, the memory system scores items by keyword relevance to the current task:

```typescript
// Memory items matching current task keywords are prioritized
const context = await memoryStore.buildContext(crewId, {
    maxTokens: 4000,
    maxItems: 10,
    relevanceKeywords: ['research', 'analysis', 'findings']
});
```

### Scoring Weights

| Match Type | Points |
|------------|--------|
| Tags (exact match) | +3 |
| Task description | +2 |
| Tools/capabilities used | +2 |
| Result content | +1 |
| Agent name | +1 |

## Memory Events

Monitor memory changes with the event system:

```typescript
import { MemoryEvent } from 'tiny-crew';

memoryStore.on(MemoryEvent.ITEM_SET, ({ crewId, key, item }) => {
    console.log(`Memory stored: ${key} by ${item.agent}`);
});

memoryStore.on(MemoryEvent.ITEMS_EVICTED, ({ crewId, count }) => {
    console.log(`Evicted ${count} items from ${crewId}`);
});

memoryStore.on(MemoryEvent.CONTEXT_BUILT, ({ crewId, itemCount, totalTokens }) => {
    console.log(`Built context with ${itemCount} items (${totalTokens} tokens)`);
});
```

## Direct Memory Operations

For advanced use cases, you can interact with memory directly:

```typescript
// Store a memory item
await memoryStore.set(crewId, 'research_results', {
    taskId: 'task_1',
    agent: 'ResearchAgent',
    task: 'Research AI trends',
    result: 'Key findings...',
    toolsUsed: ['web_search'],
    metadata: { sources: ['arxiv', 'papers'] }
});

// Query memory
const items = await memoryStore.query(crewId, {
    agent: 'ResearchAgent',
    tags: ['important'],
    sortBy: 'relevance'
});

// Get statistics
const stats = await memoryStore.getStats(crewId);
console.log(`Items: ${stats.itemCount}, Tokens: ${stats.totalTokens}`);

// Get a specific item
const item = await memoryStore.get(crewId, 'research_results');

// Delete an item
await memoryStore.delete(crewId, 'research_results');

// Clear all memory for a crew
await memoryStore.clear(crewId);
```

## Persistence with JSONFileBackend

For workflows that span multiple sessions:

```typescript
import { JSONFileBackend, MemoryStore } from 'tiny-crew/Memory';

const backend = new JSONFileBackend({
    basePath: './data/memory',
    prettyPrint: true  // Human-readable JSON files
});

const memoryStore = new MemoryStore(backend, {
    maxItems: 1000,
    autoEvict: true
});

// Memory persists between runs
// Close properly to flush pending writes
process.on('SIGINT', async () => {
    await memoryStore.close();
    process.exit(0);
});
```

## Practical Applications

### 1. Multi-Session Workflows

Use JSONFileBackend to persist research across sessions. An agent can pick up where it left off:

```typescript
// Session 1: Research phase
crew.addTask('Research competitor pricing strategies');
await crew.executeAllTasks();

// Session 2 (later): Analysis phase
// Memory from session 1 is automatically available
crew.addTask('Analyze pricing data and recommend strategy');
await crew.executeAllTasks();
```

### 2. Knowledge Accumulation

Agents build on each other's discoveries:

```typescript
const researcher = new Agent({ name: 'Researcher', goal: 'Find information' }, client);
const analyst = new Agent({ name: 'Analyst', goal: 'Analyze findings' }, client);

crew.addAgent(researcher);
crew.addAgent(analyst);

// Researcher finds data, stores in memory
crew.addTask('Research market trends for Q4');

// Analyst uses researcher's findings from memory
crew.addTask('Identify the top 3 growth opportunities');
```

### 3. Context Optimization

Relevance scoring ensures the most pertinent information reaches agents:

```typescript
// When assigning a task about "machine learning",
// memory items tagged with "ML", "AI", "neural networks"
// are prioritized in the context
crew.addTask('Explain how machine learning is transforming healthcare');
```

### 4. Resource Management

Auto-eviction prevents unbounded memory growth:

```typescript
const memoryStore = new MemoryStore(backend, {
    maxItems: 100,           // Keep last 100 items
    maxTotalTokens: 50000,   // Or max 50k tokens
    autoEvict: true          // Automatically remove old items
});
```

## Best Practices

1. **Choose the right backend**: Use `InMemoryBackend` for development and single-session work; use `JSONFileBackend` for production and persistent workflows.

2. **Set appropriate limits**: Configure `maxItems` and `maxTotalTokens` based on your use case to prevent memory bloat.

3. **Use tags effectively**: Tag important memories for easy retrieval and higher relevance scores.

4. **Monitor with events**: Use memory events to track system health and debug issues.

5. **Close properly**: Always call `memoryStore.close()` before exiting to flush pending writes.

## See Also

- [Memory Tools](./memory-tools.md) - Tools for agents to manage their own memory
- [Conversation History](./conversation-history.md) - Managing conversation context
