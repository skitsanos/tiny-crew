# TinyCrew Documentation

Welcome to the TinyCrew documentation. TinyCrew is a TypeScript framework for building multi-agent AI systems using OpenAI's API.

## Quick Links

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Installation, configuration, and first steps |
| [Memory System](./memory-system.md) | Knowledge sharing between agents |
| [Multi-Model Routing](./multi-model-routing.md) | Cost optimization with model routing |
| [Conversation History](./conversation-history.md) | Multi-turn conversations and summarization |
| [Response Streaming](./streaming.md) | Real-time response streaming |
| [Agent Messaging](./agent-messaging.md) | Agent-to-agent communication |
| [Memory Tools](./memory-tools.md) | Tools for agent memory management |
| [Custom Tools](./custom-tools.md) | Creating your own tools |
| [Advanced Patterns](./advanced-patterns.md) | Persona agents, behavioral modeling, structured protocols |
| [Use Cases](./use-cases.md) | Practical implementation scenarios |

## Core Concepts

### Agents

Specialized AI assistants with distinct goals, capabilities, and tools. Each agent focuses on specific tasks like research, analysis, or writing.

```typescript
const agent = new Agent({
    name: 'Researcher',
    goal: 'Find and analyze information',
    capabilities: ['research', 'analysis']
}, openai);
```

### Crews

Coordinators that orchestrate multiple agents to achieve a common goal. The crew assigns tasks to appropriate agents and synthesizes results.

```typescript
const crew = new Crew({
    goal: 'Produce a comprehensive market report'
}, openai);

crew.addAgent(researcher);
crew.addAgent(analyst);
crew.addAgent(writer);
```

### Memory

Shared knowledge store that enables agents to build on each other's work. Supports both in-memory and persistent storage.

### Tools

Extensions that allow agents to interact with external services, files, and APIs.

## Agent API Reference

### Methods

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

## Crew API Reference

### Methods

| Method | Description |
|--------|-------------|
| `addAgent(agent)` | Add an agent to the crew |
| `addTask(description)` | Add a task to the queue |
| `executeAllTasks()` | Execute all tasks sequentially |
| `executeTasksInParallel()` | Execute tasks in parallel |
| `achieveCrewGoal()` | Generate final summary |
| `provideFinalResponse(prompt)` | Generate custom final response |

### Events

| Event | Description |
|-------|-------------|
| `TASK_ASSIGNED` | Task assigned to an agent |
| `TASK_COMPLETED` | Task completed |
| `MEMORY_UPDATED` | Shared memory updated |
| `GOAL_ACHIEVED` | Crew goal achieved |

## Examples

### Simple Conversation

```typescript
const agent = new Agent({
    name: 'Assistant',
    goal: 'Help users with their questions'
}, new OpenAI());

const response = await agent.chat('Hello, how are you?');
const followUp = await agent.chat('What can you help me with?');
```

### Multi-Agent Collaboration

```typescript
const crew = new Crew({ goal: 'Research and report on AI trends' }, openai);

crew.addAgent(new Agent({ name: 'Researcher', goal: 'Find information' }, openai));
crew.addAgent(new Agent({ name: 'Writer', goal: 'Create reports' }, openai));

crew.addTask('Research recent AI developments');
crew.addTask('Write a summary report');

await crew.executeAllTasks();
const report = await crew.achieveCrewGoal();
```

### Agent Messaging

```typescript
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
- `tests/model-router.test.ts` - Model routing tests
- `tests/rate-limiter.test.ts` - Rate limiter tests

## Contributing

1. Create a feature branch
2. Make changes with tests
3. Run `bun test` to verify
4. Submit a pull request

## License

MIT License
