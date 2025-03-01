# Tiny Crew

## TLDR;

TinyCrew is a TypeScript framework that orchestrates multiple AI agents to solve complex tasks collaboratively. It features:

- **Agent System**: Specialized AI assistants with distinct goals and tools
- **Crew Management**: Central coordinator that assigns tasks to appropriate agents
- **Shared Memory**: Knowledge transfer between agents
- **Tool Integration**: Extensible system for agents to interact with external services
- **Event System**: Monitoring of task progress and memory updates
- **Error Handling**: Robust recovery and reporting
- **Logging**: Comprehensive activity tracking

The project enables complex AI workflows by breaking them into specialized sub-tasks, much like a team of experts working together. Applications include creative writing, research analysis, code generation, and other scenarios where multiple specialized skills are needed to achieve a cohesive outcome.

## Features

- **Enhanced Agent Architecture**: Specialized AI agents with unique capabilities, configurable system prompts, and robust tool integration.
- **Task Management System**: Complete task lifecycle management with status tracking, dependencies, and parallel execution.
- **Event-Driven Communication**: Comprehensive event system for monitoring agent activities and crew progress.
- **Configurable Memory System**: Structured shared memory with timestamps and metadata for improved knowledge sharing.
- **Secure Tool Integration**: Tool system with input validation, security controls, and flexible configuration.
- **Extensible Logging**: Enhanced logging with levels, formatting options, and support for both Node.js and Bun environments.
- **LLM-Driven Agent Selection**: Intelligent task assignment using language models to match tasks with the most suitable agent.
- **Parallel Processing**: Execute multiple tasks concurrently for improved efficiency.
- **Reflection Capabilities**: Agents can analyze and improve their performance through task reflection.
- **Customizable Prompting**: Fine-tune system prompts and task instructions for specialized agent behaviors.

## Prerequisites

- Node.js (v16+) or Bun
- TypeScript
- OpenAI API key or compatible API (e.g., Groq, Ollama, etc.)

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
   LLM_MODEL=gpt-4o
   LOG_LEVEL=INFO
   ```

## Usage

### Basic Example

```typescript
import { Crew } from './Crew';
import { Agent } from './Agent';
import OpenAI from 'openai';
import { Logger } from './Logger';
import { FileWriteTool } from './tools/FileWriteTool';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = new Logger('TinyCrew', { colorize: true });

async function main() {
  // Configure OpenAI client
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const baseModel = process.env.LLM_MODEL || 'gpt-4o';
  
  // Create a file writing tool
  const fileWriteTool = new FileWriteTool({
    basePath: process.env.FILE_WRITE_BASE_PATH || './output',
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
        }
      },
      required: ['param1']
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