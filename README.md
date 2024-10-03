# Tiny Crew

Tiny Crew is a lightweight, flexible multi-agent AI system designed to tackle complex tasks through collaboration. It leverages the power of large language models to create a team of specialized AI agents that work together to achieve a common goal.

## Features

- **Multi-Agent Collaboration**: Create a crew of AI agents, each with their own specialization and goal.
- **Flexible Task Assignment**: Automatically assign tasks to the most suitable agent based on their expertise.
- **Shared Knowledge Base**: Agents can share information and build upon each other's work.
- **Tool Integration**: Optionally equip agents with tools for interacting with external systems (e.g., file operations, database queries, web access).
- **Goal-Oriented Workflow**: Define an overarching goal for the crew and let them work towards it collaboratively.
- **Extensible Architecture**: Easily add new agents, tools, or modify existing ones to suit your specific needs.

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

3. Set up environment variables:
   Create a `.env` file in the root directory and add your API keys:
   ```
   GROQ_API_KEY=your_api_key_here
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

// Add more agents as needed
```

2. Create a crew and add agents:

```typescript
const crew = new Crew('Develop and present a comprehensive overview of recent AI advancements and their implications');
crew.addAgent(agent1);
crew.addAgent(agent2);
crew.addAgent(agent3);
```

3. Define tasks and run the crew mission:

```typescript
const tasks = [
    'Research recent advancements in AI and summarize them in 3 bullet points',
    'Analyze potential cybersecurity implications of recent AI advancements',
    'Create a brief code snippet demonstrating a simple AI concept',
    'Synthesize the research and analysis into a coherent overview'
];

async function runCrewMission() {
    for (const task of tasks) {
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
class MyNewTool implements Tool {
    name = 'MyNewTool';
    description = 'Description of what the tool does';
    schema = {
        // Define the tool's schema here
    };

    async use(args: any): Promise<any> {
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