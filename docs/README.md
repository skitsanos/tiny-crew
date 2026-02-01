# Tiny Crew Documentation

Welcome to the Tiny Crew documentation. Tiny Crew is a TypeScript framework for building multi-agent AI systems using OpenAI's API.

## Core Features

### [Conversation History Management](./conversation-history.md)

Maintain context across multi-turn conversations with automatic history management.

- `chat()` method for easy conversations
- Configurable history limits
- **Automatic summarization** of old messages
- History persistence and restoration
- Events for monitoring changes

### [Response Streaming](./streaming.md)

Stream responses in real-time for better user experience.

- `chatStream()` for streaming with history
- `performTaskStream()` for low-level control
- Support for tool calls during streaming
- Events for progress monitoring

### [Agent-to-Agent Messaging](./agent-messaging.md)

Enable agents to communicate and collaborate.

- `MessageBus` for pub/sub messaging
- Request-response patterns
- Message queuing for offline agents
- Broadcast and multi-cast support

### [Memory Tools](./memory-tools.md)

Allow agents to manage their own persistent memory.

- Core memory append and replace operations
- Long-term archival memory storage
- Semantic search for stored information
- Access control for memory blocks

## Quick Reference

### Agent Methods

| Method | Description |
|--------|-------------|
| `chat(message, context?)` | Send a message and get a response with auto-history |
| `chatStream(message, context?, onChunk?)` | Stream a response with auto-history |
| `performTask(description, context?, history?)` | Execute a task |
| `performTaskStream(description, context?, history?)` | Stream a task response |
| `getHistory()` | Get conversation history |
| `clearHistory()` | Clear conversation history |
| `summarizeHistory(keepRecentCount?)` | Summarize old messages to reduce context |
| `getConversationSummary()` | Get the current conversation summary |
| `estimateHistoryTokens()` | Estimate token count of history |
| `connectToMessageBus(bus)` | Connect to message bus |
| `sendMessage(to, content, options?)` | Send message to another agent |
| `onMessage(handler)` | Register message handler |

### Events

| Event | Description |
|-------|-------------|
| `TASK_STARTED` | Task execution started |
| `TASK_COMPLETED` | Task completed successfully |
| `TASK_FAILED` | Task failed with error |
| `TOOL_USED` | A tool was invoked |
| `MESSAGE_ADDED` | Message added to history |
| `HISTORY_CLEARED` | History was cleared |
| `HISTORY_TRIMMED` | History was trimmed |
| `HISTORY_SUMMARIZED` | History was summarized |
| `STREAM_CHUNK` | Streaming chunk received |
| `STREAM_END` | Streaming completed |
| `MESSAGE_SENT` | Agent message sent |
| `MESSAGE_RECEIVED` | Agent message received |

### Configuration

```typescript
interface AgentConfig {
    name: string;                    // Agent name
    goal: string;                    // Agent's purpose
    model?: string;                  // LLM model (default: gpt-4o-mini)
    temperature?: number;            // Response randomness
    maxTokens?: number;              // Max response tokens
    maxHistoryMessages?: number;     // History limit (default: 50)
    autoManageHistory?: boolean;     // Auto-manage in chat() (default: true)
    enableSummarization?: boolean;   // Enable auto-summarization (default: false)
    summarizationThreshold?: number; // Token threshold for summarization (default: 3000)
    summarizationModel?: string;     // Model for summarization tasks
    systemPrompt?: string;           // Custom system prompt
    capabilities?: string[];         // Agent capabilities
    preferredModel?: string;         // Override model for this agent
}
```

## Installation

```bash
bun add tiny-crew
```

## Basic Example

```typescript
import { Agent } from 'tiny-crew/Agent';
import OpenAI from 'openai';

const agent = new Agent({
    name: 'Assistant',
    goal: 'Help users with their questions'
}, new OpenAI());

// Simple conversation
const response = await agent.chat('Hello, how are you?');
console.log(response);

// Follow-up with context
const followUp = await agent.chat('What can you help me with?');
console.log(followUp);
```

## Multi-Agent Example

```typescript
import { Agent } from 'tiny-crew/Agent';
import { MessageBus } from 'tiny-crew/Agent/MessageBus';
import OpenAI from 'openai';

const client = new OpenAI();
const bus = new MessageBus();

const coordinator = new Agent({ name: 'Coordinator', goal: 'Manage workflow' }, client);
const worker = new Agent({ name: 'Worker', goal: 'Execute tasks' }, client);

coordinator.connectToMessageBus(bus);
worker.connectToMessageBus(bus);

worker.onMessage(async (ctx) => {
    const result = await worker.chat(ctx.message.content);
    ctx.reply(result);
});

const response = await coordinator.sendMessageAndWait('Worker', 'Analyze this data');
console.log(response.content);
```

## Testing

Run tests with Bun:

```bash
bun test
```

Test files:
- `tests/agent-conversation.test.ts` - Conversation history tests
- `tests/agent-streaming.test.ts` - Streaming tests
- `tests/agent-messaging.test.ts` - Messaging tests
- `tests/agent-summarization.test.ts` - Summarization tests

## Contributing

1. Create a feature branch
2. Make changes with tests
3. Run `bun test` to verify
4. Submit a pull request
