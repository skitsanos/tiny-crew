# Testing Guide

TinyCrew provides utilities for testing agents without making actual API calls. This enables fast, deterministic, and cost-free unit tests.

## Mock OpenAI Client

The `createMockOpenAIClient` function creates a mock OpenAI client that returns predetermined responses.

### Basic Usage

```typescript
import { describe, expect, it } from 'bun:test';
import { Agent } from 'tiny-crew';
import { createMockOpenAIClient } from './tests/utils/mock-openai';

describe('MyAgent', () => {
    it('responds to greetings', async () => {
        const { client, stats } = createMockOpenAIClient({
            responses: ['Hello! How can I help you today?']
        });

        const agent = new Agent({
            name: 'Assistant',
            goal: 'Help users'
        }, client);

        const response = await agent.chat('Hi there!');

        expect(response).toContain('Hello');
        expect(stats.totalCalls).toBe(1);
    });
});
```

### Configuration Options

```typescript
interface MockResponseConfig {
    /** Text responses to return in sequence */
    responses?: string[];

    /** Tool calls to simulate */
    toolCalls?: Array<{
        name: string;
        arguments: Record<string, any>;
    }>;

    /** Delay between responses in ms */
    delay?: number;

    /** Error to throw (for testing error handling) */
    error?: Error;
}
```

### Sequential Responses

Responses cycle through the array:

```typescript
const { client } = createMockOpenAIClient({
    responses: ['First response', 'Second response', 'Third response']
});

const agent = new Agent({ name: 'Test', goal: 'Test' }, client);

await agent.chat('1'); // Returns 'First response'
await agent.chat('2'); // Returns 'Second response'
await agent.chat('3'); // Returns 'Third response'
await agent.chat('4'); // Returns 'First response' (cycles)
```

### Tracking Statistics

The `stats` object tracks all API calls:

```typescript
interface MockClientStats {
    totalCalls: number;
    lastModel: string | null;
    lastInput: any[] | null;
    callHistory: Array<{
        model: string;
        input: any[];
        timestamp: number;
    }>;
}
```

Example:

```typescript
const { client, stats } = createMockOpenAIClient({
    responses: ['Response']
});

const agent = new Agent({
    name: 'Test',
    goal: 'Test',
    model: 'gpt-4o'
}, client);

await agent.chat('Hello');

expect(stats.totalCalls).toBe(1);
expect(stats.lastModel).toBe('gpt-4o');
expect(stats.callHistory).toHaveLength(1);
```

## Specialized Mock Clients

### JSON Responses

For testing structured output:

```typescript
import { createMockJsonClient } from './tests/utils/mock-openai';

const { client } = createMockJsonClient([
    { name: 'John', age: 30 },
    { name: 'Jane', age: 25 }
]);

const agent = new Agent({
    name: 'Extractor',
    goal: 'Extract data',
    responseSchema: { schema: PersonSchema, name: 'person' }
}, client);

const result = await agent.performTask('Extract person info');
const person = JSON.parse(result);

expect(person.name).toBe('John');
```

### Error Simulation

For testing error handling:

```typescript
import { createMockErrorClient } from './tests/utils/mock-openai';

const { client } = createMockErrorClient(
    new Error('API rate limit exceeded')
);

const agent = new Agent({ name: 'Test', goal: 'Test' }, client);

await expect(agent.chat('Hello')).rejects.toThrow('rate limit');
```

### Tool Call Simulation

For testing tool usage:

```typescript
import { createMockToolClient } from './tests/utils/mock-openai';

const { client } = createMockToolClient(
    [{ name: 'search', arguments: { query: 'test' } }],
    'Search completed successfully'
);

// Agent will receive tool call in response
```

### Conversational Patterns

For pattern-based responses:

```typescript
import { createConversationalMockClient } from './tests/utils/mock-openai';

const { client } = createConversationalMockClient([
    [/hello|hi/i, 'Hello! How can I help?'],
    [/weather/i, 'I cannot check the weather.'],
    [/thanks/i, 'You\'re welcome!']
]);

const agent = new Agent({ name: 'Test', goal: 'Test' }, client);

await agent.chat('Hi there!');      // 'Hello! How can I help?'
await agent.chat('What\'s the weather?'); // 'I cannot check the weather.'
await agent.chat('Thanks!');        // 'You\'re welcome!'
await agent.chat('Random');         // 'I don\'t understand.' (default)
```

## Testing Patterns

### Testing Agent Behavior

```typescript
describe('ResearchAgent', () => {
    it('includes sources in research output', async () => {
        const { client } = createMockOpenAIClient({
            responses: ['Based on my research:\n- Source 1\n- Source 2']
        });

        const agent = new Agent({
            name: 'Researcher',
            goal: 'Research topics thoroughly',
            systemPrompt: 'Always cite your sources'
        }, client);

        const result = await agent.chat('Research AI trends');

        expect(result).toContain('Source');
    });
});
```

### Testing Conversation History

```typescript
describe('Conversation History', () => {
    it('maintains context across messages', async () => {
        const { client, stats } = createMockOpenAIClient({
            responses: ['Hello!', 'Your name is John.']
        });

        const agent = new Agent({
            name: 'Assistant',
            goal: 'Remember context'
        }, client);

        await agent.chat('My name is John');
        await agent.chat('What is my name?');

        // Verify history was sent in second call
        const lastCall = stats.callHistory[1];
        expect(lastCall.input.length).toBeGreaterThan(1);
    });
});
```

### Testing Multi-Agent Coordination

```typescript
describe('Multi-Agent Workflow', () => {
    it('passes results between agents', async () => {
        const { client: researchClient } = createMockOpenAIClient({
            responses: ['Research findings: AI is advancing rapidly']
        });

        const { client: writerClient } = createMockOpenAIClient({
            responses: ['Summary: AI continues to evolve']
        });

        const researcher = new Agent({
            name: 'Researcher',
            goal: 'Research'
        }, researchClient);

        const writer = new Agent({
            name: 'Writer',
            goal: 'Summarize'
        }, writerClient);

        const research = await researcher.chat('Research AI');
        const summary = await writer.chat(`Summarize: ${research}`);

        expect(summary).toContain('Summary');
    });
});
```

### Testing Structured Output

```typescript
import { z } from 'zod';

const PersonSchema = z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string()
});

describe('Structured Output', () => {
    it('returns valid schema-compliant JSON', async () => {
        const mockData = { name: 'Jane', age: 28, occupation: 'Designer' };
        const { client } = createMockJsonClient([mockData]);

        const agent = new Agent({
            name: 'Extractor',
            goal: 'Extract person data',
            responseSchema: { schema: PersonSchema, name: 'person' }
        }, client);

        const result = await agent.performTask('Extract: Jane is a 28-year-old designer');
        const parsed = JSON.parse(result);
        const validation = PersonSchema.safeParse(parsed);

        expect(validation.success).toBe(true);
        expect(parsed.name).toBe('Jane');
    });
});
```

### Testing Message Bus

```typescript
import { MessageBus } from 'tiny-crew';

describe('Agent Messaging', () => {
    it('agents communicate via message bus', async () => {
        const bus = new MessageBus();
        const { client } = createMockOpenAIClient({ responses: ['OK'] });

        const sender = new Agent({ name: 'Sender', goal: 'Send' }, client);
        const receiver = new Agent({ name: 'Receiver', goal: 'Receive' }, client);

        sender.connectToMessageBus(bus);
        receiver.connectToMessageBus(bus);

        let received = false;
        receiver.onMessage(() => { received = true; });

        sender.sendMessage('Receiver', 'Hello');

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(received).toBe(true);

        sender.disconnectFromMessageBus();
        receiver.disconnectFromMessageBus();
    });
});
```

## Integration Tests

For tests that require actual API calls:

```typescript
const hasApiKey = !!process.env.OPENAI_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

describeWithApi('API Integration', () => {
    let client: OpenAI;

    beforeAll(() => {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    });

    it('extracts data with real API', async () => {
        const agent = new Agent({
            name: 'Extractor',
            goal: 'Extract data',
            model: 'gpt-4o-mini',
            temperature: 0.1
        }, client);

        const result = await agent.performTask('Extract: John is 30');
        expect(result).toBeDefined();
    }, 15000); // Longer timeout for API calls
});
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/agent-conversation.test.ts

# Run tests whose name matches a pattern
bun test --test-name-pattern "structured output"

# Generate a coverage profile
bun test --coverage
```

## See Also

- [Getting Started](./getting-started.md) - Setup and configuration
- [Structured Output](./structured-output.md) - Testing schema validation
- [Agent Messaging](./agent-messaging.md) - Testing message bus
