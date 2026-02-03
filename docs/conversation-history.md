# Conversation History Management

The Agent class provides built-in conversation history management for multi-turn conversations. This feature enables agents to maintain context across multiple interactions without manual history tracking.

## Configuration

When creating an agent, you can configure history management:

```typescript
import { Agent } from '@tinycrew/Agent';
import OpenAI from 'openai';

const agent = new Agent(
    {
        name: 'Assistant',
        goal: 'Help users with their questions',
        maxHistoryMessages: 50,       // Maximum messages to keep (default: 50)
        autoManageHistory: true,      // Auto-manage history in chat() (default: true)
        enableSummarization: true,    // Enable automatic summarization (default: false)
        summarizationThreshold: 3000, // Token threshold to trigger summarization
        summarizationModel: 'gpt-4o-mini' // Optional: model for summarization
    },
    new OpenAI()
);
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxHistoryMessages` | number | 50 | Maximum number of messages to keep in history. Older messages are removed when this limit is exceeded. |
| `autoManageHistory` | boolean | true | When true, the `chat()` method automatically maintains conversation history. |
| `enableSummarization` | boolean | false | Enable automatic summarization of old messages when history exceeds the token threshold. |
| `summarizationThreshold` | number | 3000 | Estimated token count that triggers automatic summarization. |
| `summarizationModel` | string | (agent's model) | Optional model to use for summarization (can use a faster/cheaper model). |

## Using the chat() Method

The `chat()` method is the recommended way to have multi-turn conversations:

```typescript
// First message
const response1 = await agent.chat('Hello, my name is Alice');
console.log(response1);
// "Hello Alice! How can I help you today?"

// Follow-up - agent remembers the context
const response2 = await agent.chat('What is my name?');
console.log(response2);
// "Your name is Alice."

// Check history length
console.log(agent.getHistoryLength()); // 4 (2 user + 2 assistant messages)
```

### Adding Context

You can provide additional context with each message:

```typescript
const memoryContext = 'User preferences: prefers formal language, timezone: EST';
const response = await agent.chat('Schedule a meeting for tomorrow', memoryContext);
```

## History Management Methods

### getHistory()

Returns a copy of the current conversation history:

```typescript
const history = agent.getHistory();
// [
//   { role: 'user', content: 'Hello' },
//   { role: 'assistant', content: 'Hi there!' }
// ]
```

### getHistoryLength()

Returns the number of messages in history:

```typescript
const count = agent.getHistoryLength(); // 2
```

### addToHistory()

Manually add a message to history:

```typescript
agent.addToHistory({ role: 'user', content: 'Custom message' });
agent.addToHistory({ role: 'assistant', content: 'Custom response' });
```

### clearHistory()

Remove all messages from history:

```typescript
agent.clearHistory();
console.log(agent.getHistoryLength()); // 0
```

### setHistory()

Replace the entire history (useful for restoring state):

```typescript
const savedHistory = [
    { role: 'user', content: 'Previous conversation' },
    { role: 'assistant', content: 'Previous response' }
];

agent.setHistory(savedHistory);
```

### exportConversationState()

Export the full conversation state for persistence:

```typescript
const state = agent.exportConversationState();
// {
//   history: [...messages],
//   agentId: 'uuid',
//   agentName: 'Assistant',
//   timestamp: 1234567890
// }

// Save to file
await Bun.write('conversation.json', JSON.stringify(state));
```

## History Trimming

When the history exceeds `maxHistoryMessages`, older messages are automatically removed. The trimming algorithm:

1. Preserves the first message if it's a system message
2. Removes the oldest non-system messages first
3. Emits a `HISTORY_TRIMMED` event

```typescript
const agent = new Agent({
    name: 'Agent',
    goal: 'Test',
    maxHistoryMessages: 10  // Keep only last 10 messages
}, client);

// After 12 messages, the 2 oldest will be trimmed
```

## Conversation Summarization

Instead of simply discarding old messages, you can enable automatic summarization. This compresses older conversation history into a concise summary while preserving key information.

### Enabling Summarization

```typescript
const agent = new Agent({
    name: 'Assistant',
    goal: 'Help users',
    maxHistoryMessages: 50,
    enableSummarization: true,        // Enable the feature
    summarizationThreshold: 3000,     // Trigger when ~3000 tokens
    summarizationModel: 'gpt-4o-mini' // Use a fast model for summaries
}, new OpenAI());
```

When enabled, the agent will:
1. Estimate the token count of conversation history
2. If tokens exceed `summarizationThreshold`, trigger summarization
3. Compress old messages into a summary
4. Keep the most recent messages intact
5. Inject the summary as context for future turns

### Manual Summarization

You can manually trigger summarization at any time:

```typescript
// Summarize history, keeping the last 10 messages
const summary = await agent.summarizeHistory();

// Keep more recent messages
const summary = await agent.summarizeHistory(20);
```

### Summarization Methods

| Method | Description |
|--------|-------------|
| `summarizeHistory(keepRecentCount?)` | Compress old messages into a summary |
| `getConversationSummary()` | Get the current summary text |
| `setConversationSummary(summary)` | Restore a previous summary |
| `isSummarizationEnabled()` | Check if summarization is enabled |
| `estimateHistoryTokens()` | Get estimated token count |

### How Summarization Works

1. **Preserves system messages**: The initial system prompt is never summarized
2. **Keeps recent messages**: The last N messages remain intact for immediate context
3. **Cumulative summaries**: New summaries build on previous summaries
4. **Fallback behavior**: If summarization fails, falls back to simple trimming

```typescript
// Example flow
const agent = new Agent({
    name: 'Bot',
    goal: 'Chat',
    enableSummarization: true,
    summarizationThreshold: 2000
}, client);

// After many messages, when tokens > 2000:
// - Old messages are summarized
// - Summary is injected as: "[Previous conversation summary: ...]"
// - Recent 10 messages are kept
// - HISTORY_SUMMARIZED event is emitted
```

### Summarization Event

```typescript
agent.on(AgentEvent.HISTORY_SUMMARIZED, (data) => {
    console.log(`Summarized ${data.summarizedCount} messages`);
    console.log(`History reduced from ${data.previousLength} to ${data.newLength}`);
    console.log(`Summary length: ${data.summaryLength} chars`);
});
```

### Best Practices for Summarization

1. **Use a fast model**: Set `summarizationModel` to a cheaper model like `gpt-4o-mini`
2. **Tune the threshold**: Adjust `summarizationThreshold` based on your context window needs
3. **Monitor token usage**: Use `estimateHistoryTokens()` to track context size
4. **Persist summaries**: Save `getConversationSummary()` for session restoration
5. **Balance recency**: Keep enough recent messages for conversational coherence

## Events

The agent emits events for history changes:

```typescript
import { AgentEvent } from '@tinycrew/utils/types';

// When a message is added
agent.on(AgentEvent.MESSAGE_ADDED, (data) => {
    console.log(`New ${data.role} message from ${data.agent}`);
});

// When history is cleared
agent.on(AgentEvent.HISTORY_CLEARED, (data) => {
    console.log(`Cleared ${data.previousLength} messages`);
});

// When history is trimmed
agent.on(AgentEvent.HISTORY_TRIMMED, (data) => {
    console.log(`Trimmed ${data.removedCount} messages, now ${data.currentLength}`);
});
```

## Message Types

The `ConversationMessage` interface supports these roles:

```typescript
interface ConversationMessage {
    role: 'system' | 'user' | 'assistant' | 'developer';
    content: string;
    name?: string;  // Optional name for multi-agent scenarios
}
```

## Best Practices

1. **Use `chat()` for conversations**: It handles history automatically
2. **Set appropriate limits**: Balance context length with token costs
3. **Preserve system messages**: They're protected during trimming
4. **Export state for persistence**: Use `exportConversationState()` to save conversations
5. **Clear history when starting fresh**: Call `clearHistory()` for new conversation topics

## Example: Persistent Conversation

```typescript
import { Agent } from '@tinycrew/Agent';
import OpenAI from 'openai';

async function main() {
    const agent = new Agent({
        name: 'PersistentBot',
        goal: 'Remember conversations across sessions'
    }, new OpenAI());

    // Try to restore previous conversation
    const savedState = await Bun.file('conversation.json').json().catch(() => null);
    if (savedState) {
        agent.setHistory(savedState.history);
        console.log(`Restored ${savedState.history.length} messages`);
    }

    // Have a conversation
    await agent.chat('Hello!');
    await agent.chat('Remember this: my favorite color is blue');

    // Save state before exit
    const state = agent.exportConversationState();
    await Bun.write('conversation.json', JSON.stringify(state, null, 2));
}
```
