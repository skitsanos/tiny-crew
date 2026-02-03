# Agent-to-Agent Messaging

The MessageBus system enables agents to communicate with each other asynchronously. This is essential for multi-agent systems where agents need to collaborate, delegate tasks, or share information.

## Quick Start

```typescript
import { Agent } from '@tinycrew/Agent';
import { MessageBus } from '@tinycrew/Agent/MessageBus';
import OpenAI from 'openai';

const client = new OpenAI();
const bus = new MessageBus();

// Create agents
const coordinator = new Agent({ name: 'Coordinator', goal: 'Manage tasks' }, client);
const worker = new Agent({ name: 'Worker', goal: 'Execute tasks' }, client);

// Connect agents to the message bus
coordinator.connectToMessageBus(bus);
worker.connectToMessageBus(bus);

// Set up message handler for worker
worker.onMessage((ctx) => {
    console.log(`Worker received: ${ctx.message.content}`);
    ctx.reply('Task acknowledged');
});

// Coordinator sends a message
coordinator.sendMessage('Worker', 'Please process the data');
```

## MessageBus

The `MessageBus` is the central hub for agent communication. It handles message routing, queuing, and delivery.

### Creating a MessageBus

```typescript
import { MessageBus, getDefaultMessageBus } from '@tinycrew/Agent/MessageBus';

// Create a new bus
const bus = new MessageBus();

// Or use the singleton default bus
const defaultBus = getDefaultMessageBus();
```

### MessageBus Events

```typescript
import { MessageBusEvent } from '@tinycrew/Agent/MessageBus';

bus.on(MessageBusEvent.MESSAGE_SENT, (data) => {
    console.log(`Message sent: ${data.message.id}`);
});

bus.on(MessageBusEvent.MESSAGE_RECEIVED, (data) => {
    console.log(`${data.recipient} received message`);
});

bus.on(MessageBusEvent.MESSAGE_DELIVERED, (data) => {
    console.log(`Message ${data.messageId} delivered`);
});

bus.on(MessageBusEvent.AGENT_REGISTERED, (data) => {
    console.log(`Agent registered: ${data.agent}`);
});
```

## Connecting Agents

Agents must be connected to a message bus before they can send or receive messages:

```typescript
// Connect to bus
agent.connectToMessageBus(bus);

// Check connection status
if (agent.isConnectedToMessageBus()) {
    console.log('Agent is connected');
}

// Disconnect when done
agent.disconnectFromMessageBus();
```

## Sending Messages

### Simple Message

```typescript
// Send a notification
agent.sendMessage('OtherAgent', 'Hello!');
```

### Message with Options

```typescript
agent.sendMessage('OtherAgent', 'Process this data', {
    type: 'request',           // Message type
    priority: 'high',          // Priority level
    metadata: {                // Custom data
        taskId: '123',
        deadline: Date.now() + 3600000
    }
});
```

### Message Types

| Type | Description |
|------|-------------|
| `notification` | One-way informational message (default) |
| `request` | Expects a reply |
| `response` | Reply to a request |
| `handoff` | Transfer of task/conversation |
| `broadcast` | Message to multiple agents |

### Priority Levels

| Priority | Description |
|----------|-------------|
| `low` | Process when convenient |
| `normal` | Standard priority (default) |
| `high` | Process soon |
| `urgent` | Process immediately |

## Receiving Messages

Register a message handler to receive incoming messages:

```typescript
const unsubscribe = agent.onMessage((ctx) => {
    const { message } = ctx;

    console.log(`From: ${message.from}`);
    console.log(`Content: ${message.content}`);
    console.log(`Type: ${message.type}`);

    // Reply if needed
    if (message.type === 'request') {
        ctx.reply('Here is my response', {
            result: 'success'
        });
    }
});

// Later, stop receiving messages
unsubscribe();
```

### Multiple Handlers

You can register multiple handlers:

```typescript
// Handler for logging
agent.onMessage((ctx) => {
    console.log(`[LOG] ${ctx.message.from}: ${ctx.message.content}`);
});

// Handler for processing
agent.onMessage(async (ctx) => {
    if (ctx.message.type === 'request') {
        const result = await processRequest(ctx.message);
        ctx.reply(result);
    }
});
```

## Request-Response Pattern

### Using sendMessageAndWait()

For synchronous request-response communication:

```typescript
try {
    const reply = await agent.sendMessageAndWait(
        'Calculator',
        'What is 2 + 2?',
        { type: 'request' },
        5000  // Timeout in ms
    );

    console.log('Answer:', reply.content);
} catch (error) {
    console.error('Timeout or error:', error.message);
}
```

### Implementing a Responder

```typescript
calculator.onMessage((ctx) => {
    if (ctx.message.type === 'request') {
        const question = ctx.message.content;
        // Process the question...
        ctx.reply('The answer is 4', { calculated: true });
    }
});
```

## Broadcasting

Send a message to all connected agents:

```typescript
// Broadcast to everyone except self
agent.broadcastMessage('System maintenance in 5 minutes', {
    priority: 'high',
    metadata: { type: 'announcement' }
});
```

## Multi-Cast

Send to specific multiple agents:

```typescript
agent.sendMessage(
    ['Agent1', 'Agent2', 'Agent3'],
    'Team meeting starting now'
);
```

## Message Queuing

Messages sent to offline agents are automatically queued:

```typescript
// Agent not yet connected
bus.send('Sender', 'OfflineAgent', 'Queued message');

// Check queue length
console.log(bus.getQueueLength('OfflineAgent')); // 1

// When agent connects, queued messages are delivered
offlineAgent.connectToMessageBus(bus);
// Message is automatically delivered!
```

### Queue Priority

Queued messages are delivered in priority order when an agent connects:
1. Urgent
2. High
3. Normal
4. Low

Within the same priority, messages are delivered in timestamp order (FIFO).

## Agent Events

Agents emit events for messaging:

```typescript
import { AgentEvent } from '@tinycrew/utils/types';

agent.on(AgentEvent.MESSAGE_SENT, (data) => {
    console.log(`Sent to ${data.to}: ${data.message.content}`);
});

agent.on(AgentEvent.MESSAGE_RECEIVED, (data) => {
    console.log(`Received from ${data.from}: ${data.message.content}`);
});
```

## Common Patterns

### Task Delegation

```typescript
// Coordinator delegates task to specialist
coordinator.onMessage(async (ctx) => {
    if (ctx.message.content.includes('translate')) {
        // Delegate to translator
        const result = await coordinator.sendMessageAndWait(
            'Translator',
            ctx.message.content,
            { type: 'request', metadata: ctx.message.metadata }
        );
        ctx.reply(result.content);
    }
});
```

### Conversation Handoff

```typescript
// Transfer conversation from one agent to another
frontDesk.onMessage((ctx) => {
    if (needsSpecialist(ctx.message)) {
        // Hand off to specialist with context
        frontDesk.sendMessage('Specialist', 'New case handoff', {
            type: 'handoff',
            metadata: {
                conversationHistory: getHistory(),
                customerInfo: ctx.message.metadata.customer,
                issue: ctx.message.content
            }
        });
    }
});

specialist.onMessage((ctx) => {
    if (ctx.message.type === 'handoff') {
        // Restore context and continue
        const { conversationHistory, customerInfo } = ctx.message.metadata;
        // ... continue handling
    }
});
```

### Pub/Sub Pattern

```typescript
// Publisher sends updates
publisher.broadcastMessage(JSON.stringify({
    event: 'price_update',
    data: { symbol: 'AAPL', price: 150.25 }
}));

// Subscribers filter by interest
subscriber.onMessage((ctx) => {
    const event = JSON.parse(ctx.message.content);
    if (event.event === 'price_update') {
        handlePriceUpdate(event.data);
    }
});
```

### Load Balancing

```typescript
const workers = ['Worker1', 'Worker2', 'Worker3'];
let currentWorker = 0;

coordinator.onMessage((ctx) => {
    if (ctx.message.type === 'request') {
        // Round-robin distribution
        const worker = workers[currentWorker];
        currentWorker = (currentWorker + 1) % workers.length;

        coordinator.sendMessage(worker, ctx.message.content, {
            type: 'request',
            metadata: { originalFrom: ctx.message.from }
        });
    }
});
```

## AgentMessage Interface

```typescript
interface AgentMessage {
    id: string;                    // Unique message ID
    from: string;                  // Sender agent name
    to: string | string[];         // Recipient(s)
    type: AgentMessageType;        // Message type
    content: string;               // Message content
    metadata?: Record<string, any>; // Custom metadata
    timestamp: number;             // Unix timestamp
    replyTo?: string;              // ID of message being replied to
    priority?: 'low' | 'normal' | 'high' | 'urgent';
}
```

## Best Practices

1. **Always disconnect on shutdown**: Clean up resources properly
2. **Handle timeouts**: Use try/catch with `sendMessageAndWait()`
3. **Use appropriate message types**: Helps with filtering and routing
4. **Include metadata**: Useful for tracing and debugging
5. **Set priorities appropriately**: Don't overuse 'urgent'
6. **Unsubscribe handlers when done**: Prevent memory leaks
7. **Use meaningful agent names**: Easier debugging and logging

## Example: Multi-Agent System

```typescript
import { Agent } from '@tinycrew/Agent';
import { MessageBus } from '@tinycrew/Agent/MessageBus';
import OpenAI from 'openai';

async function main() {
    const client = new OpenAI();
    const bus = new MessageBus();

    // Create specialized agents
    const router = new Agent({ name: 'Router', goal: 'Route requests' }, client);
    const researcher = new Agent({ name: 'Researcher', goal: 'Research topics' }, client);
    const writer = new Agent({ name: 'Writer', goal: 'Write content' }, client);

    // Connect all to bus
    [router, researcher, writer].forEach(a => a.connectToMessageBus(bus));

    // Router logic
    router.onMessage(async (ctx) => {
        if (ctx.message.content.includes('research')) {
            const result = await router.sendMessageAndWait('Researcher', ctx.message.content);
            ctx.reply(result.content);
        } else if (ctx.message.content.includes('write')) {
            const result = await router.sendMessageAndWait('Writer', ctx.message.content);
            ctx.reply(result.content);
        }
    });

    // Researcher logic
    researcher.onMessage(async (ctx) => {
        const research = await researcher.chat(ctx.message.content);
        ctx.reply(research);
    });

    // Writer logic
    writer.onMessage(async (ctx) => {
        const content = await writer.chat(ctx.message.content);
        ctx.reply(content);
    });

    // Send a request through the router
    const response = await bus.sendAndWait(
        'User',
        'Router',
        'Please research AI trends and write a summary'
    );

    console.log('Final response:', response.content);

    // Cleanup
    [router, researcher, writer].forEach(a => a.disconnectFromMessageBus());
}
```
