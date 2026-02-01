# Tiny Crew

## TLDR;

TinyCrew is a TypeScript framework that orchestrates multiple AI agents to solve complex tasks collaboratively. It features:

- **Agent System**: Specialized AI assistants with distinct goals and tools
- **Crew Management**: Central coordinator that assigns tasks to appropriate agents
- **Memory System**: Persistent knowledge storage with pluggable backends (in-memory or JSON file)
- **Tool Integration**: Extensible system for agents to interact with external services
- **Event System**: Monitoring of task progress and memory updates
- **Error Handling**: Robust recovery and reporting
- **Logging**: Comprehensive activity tracking

The project enables complex AI workflows by breaking them into specialized sub-tasks, much like a team of experts working together. Applications include creative writing, research analysis, code generation, and other scenarios where multiple specialized skills are needed to achieve a cohesive outcome.

## Features

TinyCrew represents a solid foundation for many agentic tasks, but with some important considerations:

**Strengths:**

- The multi-agent architecture with specialized roles works well for collaborative tasks
- The memory system enables effective knowledge-building between agents with optional persistence
- The event system provides good visibility into the process
- Tool integration allows for real-world interactions
- The reflection capability enables some self-improvement

**Limitations:**

- There's no built-in web browsing or search capability (though you could add this)
- The task planning is relatively simple compared to more sophisticated planning frameworks
- It doesn't have built-in knowledge graph or vector storage for more complex information relationships
- There's limited autonomous decision-making about which tasks to perform next

For many practical use cases like content creation, basic research, and collaborative problem-solving, TinyCrew provides enough structure to be effective. The framework is particularly well-suited for tasks where:

1. The workflow is relatively well-defined
2. Tasks can be cleanly divided between specialized agents
3. Tool usage is straightforward

For more complex scenarios involving dynamic planning, autonomous exploration, or long-running processes, you might need to extend TinyCrew with additional capabilities or integrate it with other systems.

### Features in details

- **Enhanced Agent Architecture**: Specialized AI agents with unique capabilities, configurable system prompts, and robust tool integration.
- **Task Management System**: Complete task lifecycle management with status tracking, dependencies, and parallel execution.
- **Event-Driven Communication**: Comprehensive event system for monitoring agent activities and crew progress.
- **Pluggable Memory System**: MemoryStore with swappable backends (InMemoryBackend, JSONFileBackend), auto-eviction, keyword-aware relevance scoring, and event notifications.
- **Secure Tool Integration**: Tool system with input validation, security controls, and flexible configuration.
- **Extensible Logging**: Enhanced logging with levels, formatting options, and support for both Node.js and Bun environments.
- **LLM-Driven Agent Selection**: Intelligent task assignment using language models to match tasks with the most suitable agent.
- **Parallel Processing**: Execute multiple tasks concurrently for improved efficiency.
- **Reflection Capabilities**: Agents can analyze and improve their performance through task reflection.
- **Customizable Prompting**: Fine-tune system prompts and task instructions for specialized agent behaviors.

## Prerequisites

- Bun (v1.2.x or newer) or Node.js (v22+)
- TypeScript
- OpenAI API key (uses OpenAI Responses API)

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/skitsanos/tiny-crew.git
   cd tiny-crew
   ```

2. Install dependencies:

   ```
   npm install
   ```

   or

   ```
   bun install
   ```

3. Set up environment variables: Create a `.env` file in the root directory and add your API keys:

   ```
   OPENAI_API_KEY=your_api_key_here
   DEFAULT_MODEL=gpt-4o
   LOG_LEVEL=INFO
   LOG_DUAL_OUTPUT=false # set to true to mirror structured JSON logs
   LOG_JSON_STREAM=stdout # use 'stderr' to send JSON logs to stderr
   ```

### Logging configuration

TinyCrew ships with a flexible logger that works in both Bun and Node runtimes. By default it prints colourised text logs, but you can mirror structured JSON alongside them for ingestion into log pipelines:

- `LOG_DUAL_OUTPUT=true` will emit the regular text line **and** a JSON line for each event.
- `LOG_JSON_STREAM=stderr` can be set if you want the JSON payloads written to stderr while keeping the colour text on stdout (default is stdout for both).
- `LOG_OUTPUT_FORMAT=json` switches entirely to JSON-only logging.
- `LOG_COLORIZE=false` disables ANSI colours when running in environments that don't support them.

All options can also be overridden programmatically when instantiating `new Logger(...)`.

## API Changes

### Version 2.5.0 - Multi-Model Support

**New Feature**: Route different LLM operations to different models based on their purpose. Use cheaper, faster models for routine tasks and more capable models for complex reasoning.

```bash
# Environment variables for model routing
DEFAULT_MODEL=gpt-4o                    # Fallback for all purposes
MODEL_AGENT_SELECTION=gpt-4o-mini       # Selecting which agent handles a task
MODEL_TASK_EXECUTION=gpt-4o             # Agent task execution
MODEL_TOOL_SYNTHESIS=gpt-4o             # Synthesizing tool outputs
MODEL_FINAL_RESPONSE=gpt-4o             # Crew final response
MODEL_GOAL_ACHIEVEMENT=gpt-4o           # Crew goal summary
MODEL_REFLECTION=gpt-4o-mini            # Agent self-reflection
```

See [Multi-Model Routing](#multi-model-routing) in Advanced Features for details.

### Version 2.4.0 Breaking Changes

**Environment Variable Renamed**: `LLM_MODEL` → `DEFAULT_MODEL`

**Memory System**: The legacy `SharedMemory` system has been replaced with `MemoryStore`. See the [Memory System](#memory-system) section for the new API.

---

**Version 2.3.0+** introduces significant updates to improve reliability and performance:

### OpenAI Responses API Migration

TinyCrew now uses the OpenAI Responses API instead of the Chat Completions API for better tool calling support:

- **Improved Tool Calling**: More reliable tool execution with proper argument parsing
- **Strict Mode Support**: All tool schemas now require complete parameter definitions
- **Enhanced Error Handling**: Automatic retry logic for robust operation
- **Better Logging**: Comprehensive debugging information for troubleshooting

### File Organization

All example outputs are now consolidated in the `data/` directory:

- **Consistent Output Location**: All agents save files to `./data/` by default
- **Organized Storage**: Examples create organized file structures
- **Easy Cleanup**: Single directory to manage generated content

### Tool Schema Requirements

When creating custom tools, all parameters must be marked as required for strict mode compatibility:

```typescript
// ✅ Correct: All parameters required with defaults
parameters: {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'URL to process' },
    format: { type: 'string', description: 'Output format', default: 'json' }
  },
  required: ['url', 'format'] // All parameters must be required
}

// ❌ Incorrect: Optional parameters not supported in strict mode
parameters: {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'URL to process' },
    format: { type: 'string', description: 'Output format' } // Optional
  },
  required: ['url'] // Some parameters missing from required array
}
```

## Usage

### Basic Example

```typescript
import { Crew } from './Crew';
import { Agent } from './Agent';
import OpenAI from 'openai';
import Logger from './utils/logger';
import { FileWriteTool } from './Tools/FileWriteTool';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = new Logger('TinyCrew', { colorize: true });

async function main() {
  // Configure OpenAI client
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const baseModel = process.env.DEFAULT_MODEL || 'gpt-4o';
  
  // Create a file writing tool
  const fileWriteTool = new FileWriteTool({
    basePath: process.env.FILE_WRITE_BASE_PATH || './data',
    allowedExtensions: ['.txt', '.md', '.json', '.py']
  });

  // Create a crew with a specific goal
  const crew = new Crew(
    {
      goal: 'Develop a comprehensive overview of recent AI advancements',
      model: baseModel
    },
    openai
  );
  
  // Create specialized agents
  const researchAgent = new Agent({
    name: 'Alice',
    goal: 'Conduct research and provide concise summaries',
    capabilities: ['research', 'summarization']
  }, openai);
  
  const developerAgent = new Agent({
    name: 'Bob',
    goal: 'Perform code writing tasks and generate examples',
    capabilities: ['coding', 'file_management']
  }, openai, [fileWriteTool]);
  
  // Add agents to crew
  crew.addAgent(researchAgent);
  crew.addAgent(developerAgent);
  
  // Add tasks to the queue
  crew.addTask('Research recent advancements in AI and summarize them');
  crew.addTask('Create a Python example demonstrating basic AI concepts');
  
  // Execute all tasks
  await crew.executeAllTasks();
  
  // Generate final summary
  const summary = await crew.achieveCrewGoal();
  console.log('Mission completed!', summary);
}

main();
```

### Creative Writing Example

```typescript
// Create specialized writing agents
const plotWriter = new Agent({
  name: 'Plot Developer',
  goal: 'Develop engaging plot points and story structure',
  capabilities: ['plot_development', 'story_structure'],
  temperature: 0.7
}, openai);

const characterDesigner = new Agent({
  name: 'Character Designer',
  goal: 'Create detailed character profiles',
  capabilities: ['character_development', 'motivation_design'],
  temperature: 0.7
}, openai);

// Add more creative agents...

// Add agents to crew
crew.addAgent(plotWriter);
crew.addAgent(characterDesigner);

// Define writing tasks
crew.addTask('Develop a plot outline for a sci-fi story about time travel');
crew.addTask('Create profiles for 3-5 main characters in the story');

// Execute tasks sequentially
await crew.executeAllTasks();

// Generate final story
const finalStory = await crew.provideFinalResponse(
  'Write a complete story integrating all elements'
);
```

## Advanced Features

### Memory System

TinyCrew features a pluggable memory system that enables knowledge sharing between agents with optional persistence across sessions.

#### Memory Architecture

The memory system consists of three main components:

1. **MemoryStore**: High-level API for storing and retrieving task results with automatic eviction, event notifications, and context building for LLM prompts.

2. **Backends**: Pluggable storage implementations:
   - `InMemoryBackend` (default): Fast, ephemeral storage
   - `JSONFileBackend`: File-based persistence with atomic writes

3. **MemoryItem**: Each stored item contains:
   - Task description and result
   - Agent attribution and timestamps
   - Token count estimation
   - Access tracking for relevance scoring
   - Optional tags and metadata

#### Basic Usage

```typescript
import { Crew, MemoryStore, JSONFileBackend } from 'tiny-crew';

// Create a persistent memory store
const memoryStore = new MemoryStore(
  new JSONFileBackend({ basePath: './data/memory' }),
  {
    maxItems: 500,
    maxTotalTokens: 50000,
    autoEvict: true
  }
);

// Create crew with memory
const crew = new Crew(
  { goal: 'Research and analyze topics', model: 'gpt-4o' },
  openai,
  { memoryStore }
);

// Add agents and execute tasks...
// Task results are automatically stored in memory

// Close memory store when done (flushes pending writes)
await memoryStore.close();
```

#### Memory Configuration

```typescript
const memoryStore = new MemoryStore(backend, {
  defaultTtl: 0,           // Time-to-live in ms (0 = never expires)
  maxItems: 1000,          // Maximum items before eviction
  maxTotalTokens: 100000,  // Token budget for all items
  summarizeThreshold: 2000, // Token count to trigger summarization
  autoEvict: true,         // Enable automatic eviction
  evictInterval: 60000     // Eviction check interval (ms)
});
```

#### Keyword-Aware Relevance

When building context for agents, the memory system scores items by keyword relevance to the current task:

```typescript
// Memory items matching current task keywords are prioritized
const context = await memoryStore.buildContext(crewId, {
  maxTokens: 4000,
  maxItems: 10,
  relevanceKeywords: ['research', 'analysis', 'findings']
});
```

Scoring weights:
- Tags: +3 points (exact match)
- Task description: +2 points
- Tools/capabilities used: +2 points
- Result content: +1 point
- Agent name: +1 point

#### Memory Events

```typescript
import { MemoryEvent } from 'tiny-crew';

memoryStore.on(MemoryEvent.ITEM_SET, ({ crewId, key, item }) => {
  console.log(`Memory stored: ${key} by ${item.agent}`);
});

memoryStore.on(MemoryEvent.ITEMS_EVICTED, ({ crewId, count }) => {
  console.log(`Evicted ${count} items from ${crewId}`);
});
```

#### Direct Memory Operations

```typescript
// Store a memory item directly
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
```

#### Practical Applications

1. **Multi-session workflows**: Use JSONFileBackend to persist research across sessions
2. **Knowledge accumulation**: Agents build on each other's discoveries
3. **Context optimization**: Relevance scoring ensures most pertinent information reaches agents
4. **Resource management**: Auto-eviction prevents unbounded memory growth

See `examples/PersistentMemory.ts` for a complete example.

### Conversation Summarization

For long-running conversations, agents can automatically summarize older messages to reduce context size while preserving key information. This is especially useful when working within token limits.

#### Enabling Summarization

```typescript
const agent = new Agent({
    name: 'Assistant',
    goal: 'Help with complex tasks',
    maxHistoryMessages: 100,
    enableSummarization: true,        // Enable automatic summarization
    summarizationThreshold: 3000,     // Trigger when ~3000 tokens estimated
    summarizationModel: 'gpt-4o-mini' // Use a fast model for summaries
}, client);
```

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableSummarization` | boolean | false | Enable automatic summarization |
| `summarizationThreshold` | number | 3000 | Estimated token count to trigger summarization |
| `summarizationModel` | string | (agent's model) | Model used for generating summaries |

#### How It Works

When enabled, the agent:
1. Estimates token count after each conversation turn
2. If tokens exceed the threshold, triggers summarization
3. Compresses old messages into a concise summary
4. Keeps the most recent 10 messages intact
5. Injects the summary as context for future turns
6. Emits a `HISTORY_SUMMARIZED` event

#### Manual Summarization

```typescript
// Manually trigger summarization
const summary = await agent.summarizeHistory();

// Keep more recent messages (default: 10)
const summary = await agent.summarizeHistory(20);

// Get the current summary
const existingSummary = agent.getConversationSummary();

// Check estimated token count
const tokens = agent.estimateHistoryTokens();
```

#### Events

```typescript
import { AgentEvent } from 'tiny-crew';

agent.on(AgentEvent.HISTORY_SUMMARIZED, (data) => {
    console.log(`Summarized ${data.summarizedCount} messages`);
    console.log(`History: ${data.previousLength} → ${data.newLength} messages`);
    console.log(`Summary length: ${data.summaryLength} chars`);
});
```

See the [detailed documentation](./docs/conversation-history.md#conversation-summarization) for more examples.

### Multi-Model Routing

TinyCrew supports routing different LLM operations to different models based on their purpose. This enables cost optimization by using cheaper/faster models for routine tasks while reserving more capable models for complex reasoning.

#### Model Purposes

| Purpose | Description | Recommended Model |
|---------|-------------|-------------------|
| `agent_selection` | Selecting which agent handles a task | `gpt-4o-mini` |
| `task_execution` | Agent task execution | `gpt-4o` |
| `tool_synthesis` | Synthesizing tool outputs into responses | `gpt-4o` |
| `final_response` | Crew's final response generation | `gpt-4o` |
| `goal_achievement` | Crew goal summary | `gpt-4o` |
| `reflection` | Agent self-reflection | `gpt-4o-mini` |
| `summarization` | Text summarization tasks | `gpt-4o-mini` |
| `translation` | Text translation tasks | `gpt-4o-mini` |
| `planning` | Task planning | `gpt-4o` |

#### Environment-Based Configuration

The simplest way to configure model routing is via environment variables:

```bash
DEFAULT_MODEL=gpt-4o                    # Fallback for all purposes
MODEL_AGENT_SELECTION=gpt-4o-mini       # Cheap model for agent selection
MODEL_TASK_EXECUTION=gpt-4o             # Capable model for task work
MODEL_REFLECTION=gpt-4o-mini            # Cheap model for reflection
```

TinyCrew automatically loads these when creating a Crew:

```typescript
// Automatically uses ModelRouter.fromEnv()
const crew = new Crew({ goal: 'Research AI trends' }, openai);
```

#### Programmatic Configuration

For more control, create a `ModelRouter` explicitly:

```typescript
import { Crew, Agent, ModelRouter } from 'tiny-crew';

const router = new ModelRouter({
  defaultModel: 'gpt-4o',
  models: {
    agent_selection: 'gpt-4o-mini',
    reflection: 'gpt-4o-mini',
    task_execution: 'gpt-4o'
  }
});

const crew = new Crew(
  { goal: 'Research AI trends' },
  openai,
  [],  // chatHistory
  { modelRouter: router }
);
```

#### Per-Agent Model Override

Individual agents can specify a `preferredModel` that overrides the router for their task execution:

```typescript
const cheapAgent = new Agent({
  name: 'Summarizer',
  goal: 'Summarize content quickly',
  preferredModel: 'gpt-4o-mini',  // Always uses mini for task execution
  capabilities: ['summarization']
}, openai);

const powerAgent = new Agent({
  name: 'Analyst',
  goal: 'Deep analysis requiring strong reasoning',
  preferredModel: 'gpt-4o',  // Uses more capable model
  capabilities: ['analysis', 'reasoning']
}, openai);

crew.addAgent(cheapAgent);
crew.addAgent(powerAgent);
```

The `preferredModel` only affects `task_execution` and `tool_synthesis` purposes. Other purposes (like `reflection`) still use the router.

#### Model Resolution Priority

When determining which model to use for an operation:

1. **Agent's preferredModel** (for task_execution/tool_synthesis only)
2. **ModelRouter's purpose-specific model** (if configured)
3. **ModelRouter's defaultModel**

#### Default Model Fallback

When no environment variables are set and no explicit configuration is provided, TinyCrew uses `gpt-4o-mini` as the hardcoded fallback for all purposes. This ensures the system works out of the box without configuration.

**Fallback chain:**
1. Purpose-specific env var (e.g., `MODEL_TASK_EXECUTION`)
2. `DEFAULT_MODEL` env var
3. Hardcoded fallback: `gpt-4o-mini`

#### Model Name Validation

ModelRouter validates model names and warns about potential typos:

```typescript
// Warns: model doesn't match known patterns
const router = new ModelRouter({
  defaultModel: 'gpt-4o-min'  // Typo! Should be 'gpt-4o-mini'
});

// Suppress warnings for custom/self-hosted models
const router = new ModelRouter({
  defaultModel: 'my-custom-model',
  warnOnUnknown: false
});

// Use an explicit allowlist for strict validation
const router = new ModelRouter({
  defaultModel: 'gpt-4o',
  allowedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
});
```

#### Cost Optimization Strategy

A typical cost-optimized configuration:

```bash
# Use mini for routine, deterministic tasks
MODEL_AGENT_SELECTION=gpt-4o-mini
MODEL_REFLECTION=gpt-4o-mini

# Use capable model for complex reasoning
MODEL_TASK_EXECUTION=gpt-4o
MODEL_FINAL_RESPONSE=gpt-4o
MODEL_GOAL_ACHIEVEMENT=gpt-4o

# Fallback
DEFAULT_MODEL=gpt-4o
```

This can reduce costs by 50-70% on routine operations while maintaining quality for complex tasks.

### Parallel Task Execution

```typescript
// Add multiple tasks
crew.addTask('Task 1');
crew.addTask('Task 2');
crew.addTask('Task 3');

// Execute tasks in parallel
const results = await crew.executeTasksInParallel();
```

### Event Monitoring

```typescript
// Monitor crew events
crew.on('task_assigned', (data) => {
  console.log(`Task assigned to ${data.agent}: ${data.task}`);
});

crew.on('memory_updated', (data) => {
  console.log(`Memory updated by ${data.update.agent}`);
});

// Monitor agent events
agent.on('task_completed', (result) => {
  console.log(`Task completed: ${result.task}`);
});
```

### Agent Reflection

Agent Reflection is a powerful feature that allows agents to analyze their own performance and learn from completed tasks. This introspective capability helps agents improve over time and provides valuable insights into their decision-making process.

```typescript
// After a task is completed
const taskId = 'task_123';
const reflection = await agent.reflect(taskId);
console.log('Agent reflection:', reflection);
```

Reflections help agents:

- Identify strengths and weaknesses in their approach
- Recognize patterns across similar tasks
- Suggest improvements for future task execution
- Provide transparency into their reasoning process
- Document lessons learned for the crew's shared knowledge

Example reflection prompt customization:

```typescript
const agent = new Agent({
  name: 'ResearchAgent',
  goal: 'Conduct thorough research on topics',
  capabilities: ['research', 'analysis'],
  metadata: {
    reflectionPrompt: `
      Analyze how you approached this {task}.
      What information sources did you prioritize?
      What search strategies were effective?
      What could you improve next time?
      What unexpected challenges did you encounter?
    `
  }
}, openai);
```

Reflections are stored in the task's metadata and can be accessed later for agent performance analysis or to inform future task strategies.

## Extending TinyCrew

### Creating Custom Tools

Implement the `Tool` interface to create custom tools:

```typescript
import { Tool, ToolSchema } from '../types';
import { Logger } from '../Logger';

export class CustomTool implements Tool {
  public readonly name = 'CustomTool';
  public readonly description = 'Description of what the tool does';
  private readonly logger: Logger;
  
  constructor() {
    this.logger = new Logger('CustomTool');
  }
  
  public readonly schema: ToolSchema = {
    name: this.name,
    description: this.description,
    parameters: {
      type: 'object',
      properties: {
        param1: {
          type: 'string',
          description: 'Description of parameter 1'
        },
        param2: {
          type: 'boolean',
          description: 'Description of parameter 2',
          default: false
        }
      },
      required: ['param1', 'param2'] // All parameters required for strict mode
    }
  };
  
  public validateInput(args: any): boolean {
    // Validate input
    return true;
  }
  
  public async use(args: any): Promise<any> {
    // Implement tool functionality
    this.logger.info('Using custom tool with args:', args);
    return { result: 'Tool execution result' };
  }
  
  public getCapabilities(): string[] {
    return ['capability1', 'capability2'];
  }
}
```

### Memory Tools for Agents

TinyCrew includes pre-built memory tools that allow agents to manage their own persistent memory. These tools are inspired by Letta's (MemGPT) memory architecture.

```typescript
import { Agent } from 'tiny-crew';
import { PersonaMemory } from 'tiny-crew/core/PersonaMemory';
import { createMemoryTools } from 'tiny-crew/tools/MemoryTools';

// Create memory instance
const memory = new PersonaMemory({ personaId: 'assistant-001' });

// Create memory tools with optional access control
const tools = createMemoryTools(memory, {
    allowedBlocks: ['user_info', 'preferences'],  // Restrict which blocks can be modified
    includeViewTool: true,                         // Include CoreMemoryView tool
    includeArchivalTools: true                     // Include archival memory tools
});

// Create agent with memory capabilities
const agent = new Agent({
    name: 'MemoryBot',
    goal: 'Remember and recall user information'
}, client, tools);
```

#### Available Memory Tools

| Tool | Description |
|------|-------------|
| `CoreMemoryAppend` | Append content to a memory block |
| `CoreMemoryReplace` | Replace specific content in a memory block |
| `CoreMemoryView` | View current memory block contents |
| `ArchivalMemoryInsert` | Store content in long-term archival memory |
| `ArchivalMemorySearch` | Search archival memory for relevant information |

See the [Memory Tools documentation](./docs/memory-tools.md) for detailed usage.

### Creating a Plugin System

TinyCrew supports plugins to extend functionality:

```typescript
import { TinyCrewPlugin } from './types';

const analyticsPlugin: TinyCrewPlugin = {
  name: 'AnalyticsPlugin',
  description: 'Tracks and analyzes agent performance',
  
  async initialize(context: any): Promise<void> {
    // Set up plugin
  },
  
  hooks: {
    onTaskComplete: (result: any) => {
      // Track task completion
    },
    onMemoryUpdate: (memory: any) => {
      // Analyze memory usage
    }
  }
};

// Register plugin with crew
crew.registerPlugin(analyticsPlugin);
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License
