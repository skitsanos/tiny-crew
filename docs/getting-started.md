# Getting Started

This guide covers installation, configuration, and your first TinyCrew application.

## Prerequisites

- **Bun** (v1.2.x or newer) — TinyCrew is Bun-only and relies on Bun's runtime
- **TypeScript**
- **OpenAI API key** (uses OpenAI Responses API)

## Installation

### Clone the Repository

```bash
git clone https://github.com/skitsanos/tiny-crew.git
cd tiny-crew
```

### Install Dependencies

Using npm:
```bash
npm install
```

Or using Bun:
```bash
bun install
```

## Configuration

### Environment Variables

Create a `.env` file in the root directory:

```bash
OPENAI_API_KEY=your_api_key_here
DEFAULT_MODEL=gpt-4o
LOG_LEVEL=INFO
LOG_DUAL_OUTPUT=false
LOG_JSON_STREAM=stdout
```

### Logging Configuration

TinyCrew ships with a flexible logger that works in both Bun and Node runtimes. By default it prints colorized text logs, but you can mirror structured JSON alongside them for ingestion into log pipelines:

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Log level (DEBUG, INFO, WARN, ERROR, FATAL) | INFO |
| `LOG_DUAL_OUTPUT` | Emit both text and JSON logs | false |
| `LOG_JSON_STREAM` | Where to write JSON logs (stdout, stderr) | stdout |
| `LOG_OUTPUT_FORMAT` | Switch entirely to JSON-only logging | text |
| `LOG_COLORIZE` | Enable/disable ANSI colors | true |

All options can also be overridden programmatically:

```typescript
import Logger from './utils/logger';

const logger = new Logger('MyApp', {
    level: 'DEBUG',
    colorize: true,
    jsonStream: 'stderr'
});
```

## Basic Example

Here's a minimal example to get you started:

```typescript
import { Crew } from './Crew';
import { Agent } from './Agent';
import OpenAI from 'openai';

async function main() {
    // Configure OpenAI client
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Create a crew with a goal
    const crew = new Crew(
        { goal: 'Research and summarize AI trends' },
        openai
    );

    // Create specialized agents
    const researcher = new Agent({
        name: 'Researcher',
        goal: 'Find and analyze information',
        capabilities: ['research', 'analysis']
    }, openai);

    const writer = new Agent({
        name: 'Writer',
        goal: 'Create clear summaries',
        capabilities: ['writing', 'summarization']
    }, openai);

    // Add agents to crew
    crew.addAgent(researcher);
    crew.addAgent(writer);

    // Add tasks
    crew.addTask('Research recent AI breakthroughs');
    crew.addTask('Summarize findings in 3 bullet points');

    // Execute
    await crew.executeAllTasks();
    const summary = await crew.achieveCrewGoal();

    console.log('Result:', summary);
}

main();
```

## Running Examples

The `examples/` directory contains several ready-to-run examples:

```bash
# Web researcher example
bun run examples/WebResearcher.ts

# Creative writing example
bun run examples/CreativeWriter.ts

# Persistent memory example
bun run examples/PersistentMemory.ts
```

## Project Structure

```
tiny-crew/
├── src/
│   ├── Agent/           # Agent implementation
│   ├── Crew/            # Crew orchestration
│   ├── Memory/          # Memory system
│   ├── ModelRouter/     # Multi-model routing
│   ├── Tools/           # Built-in tools
│   └── utils/           # Utilities (logger, types, etc.)
├── docs/                # Documentation
├── examples/            # Example applications
├── tests/               # Test suite
└── data/                # Output directory for examples
```

## Next Steps

- [Memory System](./memory-system.md) - Learn about knowledge sharing between agents
- [Multi-Model Routing](./multi-model-routing.md) - Optimize costs with model routing
- [Conversation History](./conversation-history.md) - Manage multi-turn conversations
- [Agent Messaging](./agent-messaging.md) - Enable agent-to-agent communication
- [Streaming](./streaming.md) - Stream responses in real-time
- [Custom Tools](./custom-tools.md) - Create your own tools
