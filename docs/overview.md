# Tiny Crew: Multi-Agent AI Framework

TinyCrew is a TypeScript framework for orchestrating multiple AI agents to solve complex tasks collaboratively. It stands out by using LLMs not just for task execution, but for intelligently determining which agent is best suited for each task.

## Why TinyCrew?

Traditional multi-agent systems assign tasks based on predefined rules or simple matching algorithms. TinyCrew takes a different approach—it uses an LLM to analyze task requirements and agent capabilities in real-time, making sophisticated decisions about task allocation.

This means the system can adapt to new types of tasks or the introduction of new agents without requiring changes to the underlying assignment logic.

## Technical Foundation

- **TypeScript** - Strong typing and enhanced developer experience
- **Bun** - Bun-only; runs natively on Bun 1.2.x+ and relies on Bun's runtime APIs
- **OpenAI Responses API** - Reliable tool calling with automatic retry mechanisms
- **Peer Dependencies** - Designed for use as a submodule without dependency conflicts

## Key Features

| Feature | Description |
|---------|-------------|
| **LLM-Driven Agent Selection** | Agents are assigned based on real-time LLM analysis of task requirements |
| **Shared Memory** | Agents collaborate through a shared knowledge store with pluggable backends |
| **Tool Integration** | Extensible tool system with built-in web scraping and file management |
| **Multi-Model Routing** | Route operations to different models based on purpose for cost optimization |
| **Structured Output** | Type-safe JSON responses using Zod schemas |
| **Response Streaming** | Real-time response delivery for interactive applications |
| **Agent Messaging** | Direct agent-to-agent communication via message bus |
| **Conversation History** | Multi-turn conversations with automatic summarization |

## Quick Example

```typescript
import { Crew, Agent } from 'tiny-crew';
import OpenAI from 'openai';

const openai = new OpenAI();

// Create a crew with a goal
const crew = new Crew({
    goal: 'Develop a comprehensive market analysis report'
}, openai);

// Add specialized agents
crew.addAgent(new Agent({
    name: 'Researcher',
    goal: 'Conduct in-depth market research',
    capabilities: ['research', 'data_analysis']
}, openai));

crew.addAgent(new Agent({
    name: 'Writer',
    goal: 'Synthesize findings into reports',
    capabilities: ['writing', 'summarization']
}, openai));

// Add tasks and execute
crew.addTask('Research current AI market trends');
crew.addTask('Analyze competitive landscape');
crew.addTask('Write a comprehensive report');

await crew.executeAllTasks();
const summary = await crew.achieveCrewGoal();
```

## Use Cases

TinyCrew excels in scenarios requiring collaboration between specialized AI agents:

- **Research & Analysis** - Coordinate data gathering, analysis, and report generation
- **Content Creation** - Orchestrate research, writing, editing, and publishing workflows
- **Software Development** - Manage code review, documentation, and testing agents
- **Customer Support** - Route queries to specialized agents based on expertise
- **Education** - Create adaptive learning experiences with personalized tutoring

For detailed use case implementations, see the [Use Cases Guide](./use-cases.md).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                         Crew                            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  ...            │
│  │ + Tools │  │ + Tools │  │ + Tools │                 │
│  └────┬────┘  └────┬────┘  └────┬────┘                 │
│       │            │            │                       │
│       └────────────┴────────────┘                       │
│                    │                                    │
│            ┌───────┴───────┐                           │
│            │ Shared Memory │                           │
│            └───────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

**Crew** orchestrates multiple agents toward a common goal. It:
- Assigns tasks to the most suitable agent using LLM analysis
- Maintains shared memory for knowledge transfer between agents
- Generates comprehensive summaries of completed work

**Agents** are specialized AI assistants with distinct goals and capabilities. Each agent:
- Has a defined purpose and set of capabilities
- Can be equipped with tools for external interactions
- Maintains conversation history for multi-turn interactions

**Memory** enables agents to build on each other's work through:
- In-memory storage for ephemeral sessions
- JSON file backend for persistence
- Pluggable architecture for custom backends

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Installation and first steps |
| [Memory System](./memory-system.md) | Shared knowledge between agents |
| [Multi-Model Routing](./multi-model-routing.md) | Cost optimization with model selection |
| [Structured Output](./structured-output.md) | Type-safe JSON with Zod schemas |
| [Custom Tools](./custom-tools.md) | Creating agent tools |
| [Agent Messaging](./agent-messaging.md) | Agent-to-agent communication |
| [Advanced Patterns](./advanced-patterns.md) | Personas, protocols, orchestration |
| [Testing Guide](./testing.md) | Mock clients and testing patterns |
| [Use Cases](./use-cases.md) | Practical implementation scenarios |

## The Future of Collaborative AI

The future of AI is not just about individual models becoming more powerful, but about creating systems that can intelligently coordinate multiple specialized agents. TinyCrew provides a platform for harnessing collective intelligence—whether accelerating research, optimizing operations, or tackling complex challenges.

By leveraging LLMs for both task execution and agent assignment, TinyCrew offers flexibility and intelligence that sets it apart from traditional frameworks.
