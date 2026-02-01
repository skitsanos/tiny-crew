/**
 * Tests for Agent-to-Agent messaging functionality
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Agent } from '@/Agent';
import { MessageBus, MessageBusEvent, getDefaultMessageBus, resetDefaultMessageBus } from '@/Agent/MessageBus';
import { AgentEvent } from '@/utils/types';

// Mock OpenAI client (not used for messaging tests but required by Agent)
const mockClient = {
    responses: {
        create: mock(async () => ({
            id: 'resp_123',
            output: [],
            output_text: 'OK'
        }))
    }
} as any;

describe('MessageBus', () => {
    let bus: MessageBus;

    beforeEach(() => {
        bus = new MessageBus();
    });

    afterEach(() => {
        bus.reset();
    });

    describe('agent registration', () => {
        it('registers an agent', () => {
            bus.registerAgent('TestAgent', () => {});
            expect(bus.isAgentRegistered('TestAgent')).toBe(true);
        });

        it('emits AGENT_REGISTERED event', () => {
            let eventData: any = null;
            bus.on(MessageBusEvent.AGENT_REGISTERED, (data) => {
                eventData = data;
            });

            bus.registerAgent('TestAgent', () => {});

            expect(eventData).not.toBeNull();
            expect(eventData.agent).toBe('TestAgent');
        });

        it('unregisters an agent', () => {
            bus.registerAgent('TestAgent', () => {});
            expect(bus.isAgentRegistered('TestAgent')).toBe(true);

            bus.unregisterAgent('TestAgent');
            expect(bus.isAgentRegistered('TestAgent')).toBe(false);
        });

        it('emits AGENT_UNREGISTERED event', () => {
            bus.registerAgent('TestAgent', () => {});

            let eventData: any = null;
            bus.on(MessageBusEvent.AGENT_UNREGISTERED, (data) => {
                eventData = data;
            });

            bus.unregisterAgent('TestAgent');

            expect(eventData).not.toBeNull();
            expect(eventData.agent).toBe('TestAgent');
        });

        it('returns list of registered agents', () => {
            bus.registerAgent('AgentA', () => {});
            bus.registerAgent('AgentB', () => {});
            bus.registerAgent('AgentC', () => {});

            const agents = bus.getRegisteredAgents();
            expect(agents).toContain('AgentA');
            expect(agents).toContain('AgentB');
            expect(agents).toContain('AgentC');
            expect(agents.length).toBe(3);
        });
    });

    describe('message sending', () => {
        it('sends a message between agents', async () => {
            let received: any = null;

            bus.registerAgent('Receiver', (ctx) => {
                received = ctx.message;
            });

            bus.send('Sender', 'Receiver', 'Hello!');

            // Allow async processing
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received).not.toBeNull();
            expect(received.content).toBe('Hello!');
            expect(received.from).toBe('Sender');
        });

        it('emits MESSAGE_SENT event', () => {
            let eventData: any = null;
            bus.on(MessageBusEvent.MESSAGE_SENT, (data) => {
                eventData = data;
            });

            bus.registerAgent('Receiver', () => {});
            bus.send('Sender', 'Receiver', 'Hello!');

            expect(eventData).not.toBeNull();
            expect(eventData.message.content).toBe('Hello!');
        });

        it('includes metadata in message', async () => {
            let received: any = null;

            bus.registerAgent('Receiver', (ctx) => {
                received = ctx.message;
            });

            bus.send('Sender', 'Receiver', 'With metadata', {
                metadata: { key: 'value' }
            });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received.metadata).toEqual({ key: 'value' });
        });

        it('supports different message types', async () => {
            let received: any = null;

            bus.registerAgent('Receiver', (ctx) => {
                received = ctx.message;
            });

            bus.send('Sender', 'Receiver', 'Request', { type: 'request' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received.type).toBe('request');
        });

        it('supports message priority', async () => {
            let received: any = null;

            bus.registerAgent('Receiver', (ctx) => {
                received = ctx.message;
            });

            bus.send('Sender', 'Receiver', 'Urgent!', { priority: 'urgent' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received.priority).toBe('urgent');
        });
    });

    describe('message queuing', () => {
        it('queues messages for unregistered agents', () => {
            bus.send('Sender', 'Offline', 'Queued message');
            expect(bus.getQueueLength('Offline')).toBe(1);
        });

        it('delivers queued messages when agent registers', async () => {
            bus.send('Sender', 'LateJoiner', 'Message 1');
            bus.send('Sender', 'LateJoiner', 'Message 2');

            expect(bus.getQueueLength('LateJoiner')).toBe(2);

            const receivedMessages: string[] = [];
            bus.registerAgent('LateJoiner', (ctx) => {
                receivedMessages.push(ctx.message.content);
            });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedMessages.length).toBe(2);
            expect(receivedMessages).toContain('Message 1');
            expect(receivedMessages).toContain('Message 2');
        });

        it('clears queue after delivery', async () => {
            bus.send('Sender', 'Agent', 'Queued');
            expect(bus.getQueueLength('Agent')).toBe(1);

            bus.registerAgent('Agent', () => {});

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(bus.getQueueLength('Agent')).toBe(0);
        });

        it('can manually clear queue', () => {
            bus.send('Sender', 'Agent', 'Message 1');
            bus.send('Sender', 'Agent', 'Message 2');
            expect(bus.getQueueLength('Agent')).toBe(2);

            bus.clearQueue('Agent');
            expect(bus.getQueueLength('Agent')).toBe(0);
        });
    });

    describe('message replies', () => {
        it('allows agent to reply to messages', async () => {
            let replyReceived: any = null;

            bus.registerAgent('Responder', (ctx) => {
                ctx.reply('Got your message!');
            });

            bus.registerAgent('Requester', (ctx) => {
                replyReceived = ctx.message;
            });

            bus.send('Requester', 'Responder', 'Hello', { type: 'request' });

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(replyReceived).not.toBeNull();
            expect(replyReceived.content).toBe('Got your message!');
            expect(replyReceived.type).toBe('response');
        });

        it('sendAndWait resolves with reply', async () => {
            bus.registerAgent('Responder', (ctx) => {
                ctx.reply('Response content');
            });

            const reply = await bus.sendAndWait('Requester', 'Responder', 'Request');

            expect(reply.content).toBe('Response content');
            expect(reply.type).toBe('response');
        });

        it('sendAndWait times out if no reply', async () => {
            bus.registerAgent('Silent', () => {
                // Does not reply
            });

            try {
                await bus.sendAndWait('Requester', 'Silent', 'Hello?', {}, 100);
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect((error as Error).message).toContain('timeout');
            }
        });
    });

    describe('broadcast', () => {
        it('broadcasts to all agents except sender', async () => {
            const received: string[] = [];

            bus.registerAgent('Sender', () => {
                received.push('Sender received - should not happen');
            });
            bus.registerAgent('AgentA', () => { received.push('A'); });
            bus.registerAgent('AgentB', () => { received.push('B'); });
            bus.registerAgent('AgentC', () => { received.push('C'); });

            bus.broadcast('Sender', 'Broadcast message');

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(received).toContain('A');
            expect(received).toContain('B');
            expect(received).toContain('C');
            expect(received).not.toContain('Sender received - should not happen');
        });

        it('sets message type to broadcast', async () => {
            let receivedType: string | undefined;

            bus.registerAgent('Receiver', (ctx) => {
                receivedType = ctx.message.type;
            });

            bus.broadcast('Sender', 'Hello all');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedType).toBe('broadcast');
        });
    });

    describe('multi-recipient', () => {
        it('sends to multiple recipients', async () => {
            const received: string[] = [];

            bus.registerAgent('A', () => { received.push('A'); });
            bus.registerAgent('B', () => { received.push('B'); });
            bus.registerAgent('C', () => { received.push('C'); });

            bus.send('Sender', ['A', 'C'], 'Multi-cast');

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(received).toContain('A');
            expect(received).toContain('C');
            expect(received).not.toContain('B');
        });
    });

    describe('default bus singleton', () => {
        afterEach(() => {
            resetDefaultMessageBus();
        });

        it('returns same instance', () => {
            const bus1 = getDefaultMessageBus();
            const bus2 = getDefaultMessageBus();
            expect(bus1).toBe(bus2);
        });

        it('resets the default bus', () => {
            const bus1 = getDefaultMessageBus();
            bus1.registerAgent('Test', () => {});

            resetDefaultMessageBus();

            const bus2 = getDefaultMessageBus();
            expect(bus2).not.toBe(bus1);
            expect(bus2.isAgentRegistered('Test')).toBe(false);
        });
    });
});

describe('Agent Messaging', () => {
    let bus: MessageBus;
    let agentA: Agent;
    let agentB: Agent;

    beforeEach(() => {
        bus = new MessageBus();

        agentA = new Agent(
            { name: 'AgentA', goal: 'Test agent A' },
            mockClient
        );

        agentB = new Agent(
            { name: 'AgentB', goal: 'Test agent B' },
            mockClient
        );
    });

    afterEach(() => {
        agentA.disconnectFromMessageBus();
        agentB.disconnectFromMessageBus();
        bus.reset();
    });

    describe('connectToMessageBus', () => {
        it('connects agent to bus', () => {
            expect(agentA.isConnectedToMessageBus()).toBe(false);
            agentA.connectToMessageBus(bus);
            expect(agentA.isConnectedToMessageBus()).toBe(true);
        });

        it('registers agent name on bus', () => {
            agentA.connectToMessageBus(bus);
            expect(bus.isAgentRegistered('AgentA')).toBe(true);
        });

        it('disconnects from previous bus when connecting to new one', () => {
            const bus2 = new MessageBus();

            agentA.connectToMessageBus(bus);
            expect(bus.isAgentRegistered('AgentA')).toBe(true);

            agentA.connectToMessageBus(bus2);
            expect(bus.isAgentRegistered('AgentA')).toBe(false);
            expect(bus2.isAgentRegistered('AgentA')).toBe(true);
        });
    });

    describe('disconnectFromMessageBus', () => {
        it('disconnects agent from bus', () => {
            agentA.connectToMessageBus(bus);
            expect(agentA.isConnectedToMessageBus()).toBe(true);

            agentA.disconnectFromMessageBus();
            expect(agentA.isConnectedToMessageBus()).toBe(false);
        });

        it('unregisters agent from bus', () => {
            agentA.connectToMessageBus(bus);
            expect(bus.isAgentRegistered('AgentA')).toBe(true);

            agentA.disconnectFromMessageBus();
            expect(bus.isAgentRegistered('AgentA')).toBe(false);
        });
    });

    describe('sendMessage', () => {
        it('sends message to another agent', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let received: any = null;
            agentB.onMessage((ctx) => {
                received = ctx.message;
            });

            agentA.sendMessage('AgentB', 'Hello from A!');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received).not.toBeNull();
            expect(received.content).toBe('Hello from A!');
            expect(received.from).toBe('AgentA');
        });

        it('throws if not connected to bus', () => {
            expect(() => agentA.sendMessage('AgentB', 'Hello')).toThrow(
                'Agent is not connected to a message bus'
            );
        });

        it('emits MESSAGE_SENT event', () => {
            agentA.connectToMessageBus(bus);

            let eventData: any = null;
            agentA.on(AgentEvent.MESSAGE_SENT, (data) => {
                eventData = data;
            });

            agentA.sendMessage('AgentB', 'Hello');

            expect(eventData).not.toBeNull();
            expect(eventData.to).toBe('AgentB');
        });

        it('sends to multiple recipients', async () => {
            const agentC = new Agent({ name: 'AgentC', goal: 'Test' }, mockClient);

            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);
            agentC.connectToMessageBus(bus);

            const received: string[] = [];
            agentB.onMessage(() => { received.push('B'); });
            agentC.onMessage(() => { received.push('C'); });

            agentA.sendMessage(['AgentB', 'AgentC'], 'Multi-message');

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(received).toContain('B');
            expect(received).toContain('C');

            agentC.disconnectFromMessageBus();
        });
    });

    describe('sendMessageAndWait', () => {
        it('waits for reply', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            agentB.onMessage((ctx) => {
                ctx.reply('Got it!');
            });

            const reply = await agentA.sendMessageAndWait('AgentB', 'Request');

            expect(reply.content).toBe('Got it!');
        });

        it('throws on timeout', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            // AgentB doesn't reply

            try {
                await agentA.sendMessageAndWait('AgentB', 'Hello?', {}, 100);
                expect(true).toBe(false);
            } catch (error) {
                expect((error as Error).message).toContain('timeout');
            }
        });
    });

    describe('broadcastMessage', () => {
        it('broadcasts to all connected agents', async () => {
            const agentC = new Agent({ name: 'AgentC', goal: 'Test' }, mockClient);

            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);
            agentC.connectToMessageBus(bus);

            const received: string[] = [];
            agentB.onMessage(() => { received.push('B'); });
            agentC.onMessage(() => { received.push('C'); });

            agentA.broadcastMessage('Announcement!');

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(received).toContain('B');
            expect(received).toContain('C');

            agentC.disconnectFromMessageBus();
        });

        it('excludes sender from broadcast', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let senderReceived = false;
            agentA.onMessage(() => {
                senderReceived = true;
            });

            agentA.broadcastMessage('Hello all');

            await new Promise(resolve => setTimeout(resolve, 20));

            expect(senderReceived).toBe(false);
        });
    });

    describe('onMessage', () => {
        it('receives incoming messages', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let received: any = null;
            agentB.onMessage((ctx) => {
                received = ctx.message;
            });

            agentA.sendMessage('AgentB', 'Test message');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(received).not.toBeNull();
            expect(received.content).toBe('Test message');
        });

        it('allows multiple handlers', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let handler1Called = false;
            let handler2Called = false;

            agentB.onMessage(() => { handler1Called = true; });
            agentB.onMessage(() => { handler2Called = true; });

            agentA.sendMessage('AgentB', 'Test');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler1Called).toBe(true);
            expect(handler2Called).toBe(true);
        });

        it('returns unsubscribe function', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let callCount = 0;
            const unsubscribe = agentB.onMessage(() => {
                callCount++;
            });

            agentA.sendMessage('AgentB', 'First');
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(callCount).toBe(1);

            unsubscribe();

            agentA.sendMessage('AgentB', 'Second');
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(callCount).toBe(1); // Still 1, handler was removed
        });

        it('emits MESSAGE_RECEIVED event', async () => {
            agentA.connectToMessageBus(bus);
            agentB.connectToMessageBus(bus);

            let eventData: any = null;
            agentB.on(AgentEvent.MESSAGE_RECEIVED, (data) => {
                eventData = data;
            });

            agentA.sendMessage('AgentB', 'Hello');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(eventData).not.toBeNull();
            expect(eventData.from).toBe('AgentA');
        });
    });

    describe('getMessageHandlerCount', () => {
        it('returns 0 initially', () => {
            expect(agentA.getMessageHandlerCount()).toBe(0);
        });

        it('increments when handler added', () => {
            agentA.onMessage(() => {});
            expect(agentA.getMessageHandlerCount()).toBe(1);

            agentA.onMessage(() => {});
            expect(agentA.getMessageHandlerCount()).toBe(2);
        });

        it('decrements when handler removed', () => {
            const unsub1 = agentA.onMessage(() => {});
            const unsub2 = agentA.onMessage(() => {});
            expect(agentA.getMessageHandlerCount()).toBe(2);

            unsub1();
            expect(agentA.getMessageHandlerCount()).toBe(1);

            unsub2();
            expect(agentA.getMessageHandlerCount()).toBe(0);
        });
    });
});

describe('Agent Messaging Integration', () => {
    let bus: MessageBus;

    beforeEach(() => {
        bus = new MessageBus();
    });

    afterEach(() => {
        bus.reset();
    });

    it('supports request-response pattern', async () => {
        const calculator = new Agent(
            { name: 'Calculator', goal: 'Perform calculations' },
            mockClient
        );

        const requester = new Agent(
            { name: 'Requester', goal: 'Request calculations' },
            mockClient
        );

        calculator.connectToMessageBus(bus);
        requester.connectToMessageBus(bus);

        // Calculator handles requests
        calculator.onMessage((ctx) => {
            if (ctx.message.type === 'request') {
                const numbers = ctx.message.metadata?.numbers || [0, 0];
                const sum = numbers.reduce((a: number, b: number) => a + b, 0);
                ctx.reply(`Sum: ${sum}`, { result: sum });
            }
        });

        // Requester sends calculation request
        const reply = await requester.sendMessageAndWait(
            'Calculator',
            'Calculate sum',
            {
                type: 'request',
                metadata: { numbers: [1, 2, 3, 4, 5] }
            }
        );

        expect(reply.metadata?.result).toBe(15);

        calculator.disconnectFromMessageBus();
        requester.disconnectFromMessageBus();
    });

    it('supports conversation handoff', async () => {
        const agentA = new Agent({ name: 'AgentA', goal: 'Initial handler' }, mockClient);
        const agentB = new Agent({ name: 'AgentB', goal: 'Specialist' }, mockClient);
        const agentC = new Agent({ name: 'Coordinator', goal: 'Coordinate' }, mockClient);

        agentA.connectToMessageBus(bus);
        agentB.connectToMessageBus(bus);
        agentC.connectToMessageBus(bus);

        let handoffReceived = false;
        let handoffData: any = null;

        agentB.onMessage((ctx) => {
            if (ctx.message.type === 'handoff') {
                handoffReceived = true;
                handoffData = ctx.message.metadata;
            }
        });

        // AgentA hands off conversation to AgentB
        agentA.sendMessage('AgentB', 'Handing off this conversation', {
            type: 'handoff',
            metadata: {
                conversationHistory: ['Hello', 'How can I help?'],
                context: 'User needs specialist assistance'
            }
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(handoffReceived).toBe(true);
        expect(handoffData.context).toBe('User needs specialist assistance');

        agentA.disconnectFromMessageBus();
        agentB.disconnectFromMessageBus();
        agentC.disconnectFromMessageBus();
    });
});
