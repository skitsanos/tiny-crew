# Memory Tools

Memory tools allow agents to modify their own memory blocks, enabling persistent storage and retrieval of information across conversations. This is inspired by Letta's (MemGPT) memory architecture.

## Overview

The memory tools system provides agents with the ability to:

- **Append** new information to core memory blocks
- **Replace** existing information in memory blocks
- **Insert** content into long-term archival memory
- **Search** archival memory for relevant information
- **View** current memory block contents

## Quick Start

```typescript
import { Agent } from '@/Agent';
import { PersonaMemory } from '@/core/PersonaMemory';
import { createMemoryTools } from '@/tools/MemoryTools';
import OpenAI from 'openai';

// Create a memory instance for the persona
const memory = new PersonaMemory({ personaId: 'assistant-001' });

// Create memory tools
const tools = createMemoryTools(memory);

// Create an agent with memory tools
const agent = new Agent(
    { name: 'Assistant', goal: 'Help users and remember context' },
    new OpenAI(),
    tools
);

// The agent can now use tools to manage its own memory
const response = await agent.chat('Remember that my favorite color is blue');
```

## Available Tools

### CoreMemoryAppend

Append content to a memory block without removing existing content.

```typescript
import { createCoreMemoryAppendTool } from '@/tools/MemoryTools';

const appendTool = createCoreMemoryAppendTool(memory, ['persona', 'context']);

// Agent can call:
// CoreMemoryAppend({ label: 'persona', content: 'User prefers formal language' })
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | The memory block to append to |
| `content` | string | The content to append |

### CoreMemoryReplace

Replace specific content in a memory block (exact match required).

```typescript
import { createCoreMemoryReplaceTool } from '@/tools/MemoryTools';

const replaceTool = createCoreMemoryReplaceTool(memory);

// Agent can call:
// CoreMemoryReplace({
//     label: 'persona',
//     oldContent: 'User prefers formal',
//     newContent: 'User prefers casual'
// })
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | The memory block to modify |
| `oldContent` | string | Exact text to find and replace |
| `newContent` | string | Text to replace with |

### ArchivalMemoryInsert

Store information in long-term archival memory for later retrieval.

```typescript
import { createArchivalMemoryInsertTool } from '@/tools/MemoryTools';

const insertTool = createArchivalMemoryInsertTool(memory);

// Agent can call:
// ArchivalMemoryInsert({
//     content: 'User mentioned they work at Acme Corp',
//     category: 'user_info',
//     tags: 'employment,company,important'
// })
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | string | Content to store |
| `category` | string | Category for organization |
| `tags` | string | Comma-separated tags for searching |

### ArchivalMemorySearch

Search archival memory for relevant stored information.

```typescript
import { createArchivalMemorySearchTool } from '@/tools/MemoryTools';

const searchTool = createArchivalMemorySearchTool(memory);

// Agent can call:
// ArchivalMemorySearch({
//     query: 'user employment',
//     maxResults: 5,
//     tags: 'important'
// })
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search query (keywords or phrases) |
| `maxResults` | number | Maximum results to return (default: 5) |
| `tags` | string | Optional comma-separated tags to filter by |

### CoreMemoryView

View the current contents of memory blocks.

```typescript
import { createCoreMemoryViewTool } from '@/tools/MemoryTools';

const viewTool = createCoreMemoryViewTool(memory);

// View all blocks:
// CoreMemoryView({})

// View specific block:
// CoreMemoryView({ label: 'persona' })
```

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | (Optional) Specific block to view |

## Creating All Memory Tools

Use `createMemoryTools()` to create all memory tools at once:

```typescript
import { createMemoryTools } from '@/tools/MemoryTools';

const tools = createMemoryTools(memory, {
    // Restrict which blocks the agent can modify
    allowedBlocks: ['persona', 'context'],

    // Include the view tool (default: true)
    includeViewTool: true,

    // Include archival memory tools (default: true)
    includeArchivalTools: true
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedBlocks` | string[] | all | Restrict which memory blocks can be modified |
| `includeViewTool` | boolean | true | Include the CoreMemoryView tool |
| `includeArchivalTools` | boolean | true | Include archival memory tools |

## Memory Block Access Control

You can restrict which memory blocks an agent can modify:

```typescript
// Only allow modifying specific blocks
const tools = createMemoryTools(memory, {
    allowedBlocks: ['user_preferences', 'conversation_context']
});

// Attempting to modify other blocks returns an error:
// { success: false, error: "Access denied: Cannot modify block 'system'" }
```

## Tool Response Format

All memory tools return JSON responses:

### Success Response

```json
{
    "success": true,
    "message": "Content appended successfully",
    "block": "persona"
}
```

### Error Response

```json
{
    "success": false,
    "error": "Access denied: Cannot modify block 'system'"
}
```

### Search Results

```json
{
    "success": true,
    "message": "Found 3 matching memories",
    "results": [
        {
            "content": "User works at Acme Corp",
            "metadata": { "category": "user_info" },
            "timestamp": "2024-01-15T10:30:00.000Z"
        }
    ]
}
```

## Example: Self-Modifying Agent

Here's a complete example of an agent that can manage its own memory:

```typescript
import { Agent } from '@/Agent';
import { PersonaMemory } from '@/core/PersonaMemory';
import { createMemoryTools } from '@/tools/MemoryTools';
import OpenAI from 'openai';

async function main() {
    // Initialize memory with some default content
    const memory = new PersonaMemory({
        personaId: 'assistant-001',
        initialBlocks: {
            persona: 'I am a helpful assistant.',
            user_info: 'No user information yet.'
        }
    });

    // Create memory tools
    const tools = createMemoryTools(memory, {
        allowedBlocks: ['persona', 'user_info', 'preferences']
    });

    // Create agent with memory capabilities
    const agent = new Agent(
        {
            name: 'MemoryBot',
            goal: 'Help users and remember important information about them',
            systemPrompt: `You have access to memory tools. Use them to:
                - Store important user information
                - Update your understanding of the user
                - Recall relevant context from past conversations

                Always use CoreMemoryAppend when learning new user facts.
                Use ArchivalMemorySearch to recall past interactions.`
        },
        new OpenAI(),
        tools
    );

    // Conversation where agent learns about user
    await agent.chat("Hi, I'm Alice and I work as a software engineer");
    // Agent may call: CoreMemoryAppend({ label: 'user_info', content: 'Name: Alice, Occupation: Software Engineer' })

    await agent.chat("I prefer TypeScript over JavaScript");
    // Agent may call: CoreMemoryAppend({ label: 'preferences', content: 'Prefers TypeScript' })

    // Later conversation - agent recalls information
    await agent.chat("What do you remember about me?");
    // Agent may call: CoreMemoryView({ label: 'user_info' })
}
```

## Integration with PersonaMemory

The memory tools are designed to work with the `PersonaMemory` class, which provides:

- **Core Memory Blocks**: Named sections for different types of information
- **Archival Memory**: Long-term storage with search capabilities
- **Persistence**: Save and load memory state
- **Block Management**: Create, update, and delete memory blocks

See the PersonaMemory documentation for more details on the underlying memory system.

## Best Practices

1. **Define clear block purposes**: Use descriptive block labels that indicate their content
2. **Restrict access appropriately**: Only allow modification of blocks the agent should update
3. **Use categories and tags**: Make archival memory searchable with good organization
4. **Include memory context in prompts**: Tell the agent about its memory capabilities
5. **Persist memory state**: Save memory between sessions for continuity
6. **Monitor memory usage**: Track what agents store to ensure quality

## Events

Memory modifications emit events through the PersonaMemory instance:

```typescript
memory.on('block_updated', (data) => {
    console.log(`Block ${data.label} updated`);
});

memory.on('archival_inserted', (data) => {
    console.log(`New archival entry: ${data.key}`);
});
```
