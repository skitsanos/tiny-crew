# Tiny Crew

TinyCrew is a TypeScript framework that orchestrates multiple AI agents to solve complex tasks collaboratively.

## Features

- **Multi-Agent Orchestration** - Specialized agents with distinct goals working together
- **Shared Memory** - Knowledge transfer and persistence between agents
- **Tool Integration** - Extensible system using OpenAI Responses API
- **Structured Output** - Type-safe JSON responses with Zod schema validation
- **Conversation Management** - Multi-turn history with automatic summarization
- **Response Streaming** - Real-time response delivery
- **Agent Messaging** - Direct agent-to-agent communication
- **Multi-Model Routing** - Cost optimization with purpose-based model selection
- **Event System** - Comprehensive monitoring and hooks

## Quick Start

### Installation

```bash
git clone https://github.com/skitsanos/tiny-crew.git
cd tiny-crew
bun install
```

### Configuration

Create a `.env` file:

```bash
OPENAI_API_KEY=your_api_key_here
DEFAULT_MODEL=gpt-4o
```

### Basic Example

```typescript
import { Crew, Agent } from 'tiny-crew';
import OpenAI from 'openai';

const openai = new OpenAI();

// Create a crew with a goal
const crew = new Crew({ goal: 'Research and summarize AI trends' }, openai);

// Add specialized agents
crew.addAgent(new Agent({
    name: 'Researcher',
    goal: 'Find and analyze information',
    capabilities: ['research', 'analysis']
}, openai));

crew.addAgent(new Agent({
    name: 'Writer',
    goal: 'Create clear summaries',
    capabilities: ['writing', 'summarization']
}, openai));

// Add tasks and execute
crew.addTask('Research recent AI breakthroughs');
crew.addTask('Summarize findings in 3 bullet points');

await crew.executeAllTasks();
const summary = await crew.achieveCrewGoal();
```

### Simple Agent Conversation

```typescript
const agent = new Agent({
    name: 'Assistant',
    goal: 'Help users with questions'
}, openai);

// Conversations maintain history automatically
const response = await agent.chat('Hello!');
const followUp = await agent.chat('What can you help me with?');
```

## Documentation

Full documentation is available in the [docs/](./docs/) folder:

| Guide | Description |
|-------|-------------|
| [Getting Started](./docs/getting-started.md) | Installation, configuration, and first steps |
| [Memory System](./docs/memory-system.md) | Knowledge sharing between agents |
| [Multi-Model Routing](./docs/multi-model-routing.md) | Cost optimization with model routing |
| [Conversation History](./docs/conversation-history.md) | Multi-turn conversations and summarization |
| [Response Streaming](./docs/streaming.md) | Real-time response streaming |
| [Agent Messaging](./docs/agent-messaging.md) | Agent-to-agent communication |
| [Structured Output](./docs/structured-output.md) | Type-safe JSON responses with Zod schemas |
| [Memory Tools](./docs/memory-tools.md) | Tools for agent memory management |
| [Custom Tools](./docs/custom-tools.md) | Creating your own tools |
| [Advanced Patterns](./docs/advanced-patterns.md) | Persona agents, behavioral modeling, structured protocols |
| [Testing Guide](./docs/testing.md) | Mock clients and testing patterns |
| [Use Cases](./docs/use-cases.md) | Practical implementation scenarios |

## Examples

The `examples/` directory contains ready-to-run examples:

```bash
bun run examples/WebResearcher.ts
bun run examples/CreativeWriter.ts
bun run examples/PersistentMemory.ts
```

## Requirements

- Bun (v1.2.x+) or Node.js (v22+)
- TypeScript
- OpenAI API key

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License
