# Tiny Crew

Tiny Crew is an innovative, flexible multi-agent AI system designed to tackle complex tasks through intelligent
collaboration. It leverages the power of large language models to create a team of specialized AI agents that work
together to achieve common goals.

## Features

- **LLM-Driven Agent Selection**: Utilizes a language model to intelligently assign tasks to the most suitable agent
  based on task requirements and agent capabilities.
- **Multi-Agent Collaboration**: Create a crew of AI agents, each with their own specialization and goal.
- **Flexible Task Assignment**: Dynamically assigns tasks to agents based on their skills and available tools.
- **Shared Knowledge Base**: Agents can share information and build upon each other's work through a shared memory
  system.
- **Tool Integration**: Equip agents with tools for interacting with external systems (e.g., file operations, database
  queries, web access).
- **Goal-Oriented Workflow**: Define an overarching goal for the crew and let them work towards it collaboratively.
- **Extensible Architecture**: Easily add new agents, tools, or modify existing ones to suit your specific needs.
- **Intelligent Summarization**: Uses the LLM to generate comprehensive summaries of the crew's work, addressing the
  overall goal.

## Prerequisites

- Node.js or Bun
- TypeScript
- OpenAI API key or compatible API (e.g., Groq)

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

3. Set up environment variables:
   Create a `.env` file in the root directory and add your API keys:
   ```
   OPENAI_API_KEY=your_api_key_here
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_API_URL=https://api.groq.com/openai/v1
   ```

## Usage

1. Define your agents in the main script (e.g., `src/main.ts`):

```typescript
const agent1 = new Agent({
    name: 'Alice',
    goal: 'Conduct research and provide concise summaries',
    expectedOutput: 'Bullet points or short paragraphs',
    model: BASE_MODEL
}, openai);

const agent2 = new Agent({
    name: 'Bob',
    goal: 'Perform code writing tasks, generate code examples, and save files',
    expectedOutput: 'Confirmation that the code snippet was saved to a file',
    model: BASE_MODEL
}, openai, [new FileWriteTool()]);

// Add more agents as needed
```

2. Create a crew and add agents:

```typescript
const llm = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: process.env.GROQ_API_URL
});

const crew = new Crew('Develop and present a comprehensive overview of recent AI advancements and their implications', llm);
crew.addAgent(agent1);
crew.addAgent(agent2);
```

3. Define tasks and run the crew mission:

```typescript
const tasks = [
    'Research recent advancements in AI and summarize them in 3 bullet points',
    'Create a Python file named "example.py" with a "Hello, World!" program',
    'Synthesize the research and analysis into a coherent overview'
];

async function runCrewMission()
{
    for (const task of tasks)
    {
        const result = await crew.assignTask(task);
        console.log(`Task result: ${result}`);
    }

    const crewSummary = await crew.achieveCrewGoal();
    console.log('Crew goal achievement summary:', crewSummary);
}

runCrewMission();
```

4. Run the script:
   ```
   npx ts-node src/main.ts
   ```

## Extending Tiny Crew

### Adding New Agents

Create new agents by instantiating the `Agent` class with different goals and specializations.

### Implementing Tools

Create new tools by implementing the `Tool` interface:

```typescript
class MyNewTool implements Tool
{
    name = 'MyNewTool';
    description = 'Description of what the tool does';

    async use(args: any): Promise<any>
    {
        // Implement the tool's functionality
    }
}
```

Then, pass the tool to an agent when creating it:

```typescript
const agentWithTool = new Agent({
    // Agent configuration
}, openai, [new MyNewTool()]);
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License