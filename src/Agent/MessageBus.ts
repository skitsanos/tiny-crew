/**
 * MessageBus - Enables agent-to-agent communication
 *
 * Provides a pub/sub messaging system for agents to communicate
 * with each other asynchronously.
 */

import { randomUUID } from 'node:crypto';
import EventEmitter from 'node:events';
import Logger from '@tinycrew/utils/logger';
import type {
    AgentMessage,
    AgentMessageType,
    MessageHandler,
    MessageHandlerContext,
} from '@tinycrew/utils/types';

/**
 * Events emitted by the MessageBus
 */
export enum MessageBusEvent {
    MESSAGE_SENT = 'message_sent',
    MESSAGE_RECEIVED = 'message_received',
    MESSAGE_DELIVERED = 'message_delivered',
    MESSAGE_FAILED = 'message_failed',
    AGENT_REGISTERED = 'agent_registered',
    AGENT_UNREGISTERED = 'agent_unregistered',
}

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
    type?: AgentMessageType;
    metadata?: Record<string, any>;
    replyTo?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * MessageBus provides agent-to-agent communication
 *
 * Usage:
 * ```typescript
 * const bus = new MessageBus();
 *
 * // Register agents
 * bus.registerAgent('AgentA', (ctx) => {
 *     console.log(`Received: ${ctx.message.content}`);
 *     ctx.reply('Got it!');
 * });
 *
 * bus.registerAgent('AgentB', (ctx) => {
 *     console.log(`AgentB received: ${ctx.message.content}`);
 * });
 *
 * // Send message
 * bus.send('AgentA', 'AgentB', 'Hello!');
 * ```
 */
export class MessageBus extends EventEmitter {
    private readonly logger: Logger;
    private readonly handlers: Map<string, MessageHandler[]>;
    private readonly messageQueue: Map<string, AgentMessage[]>;
    private readonly pendingReplies: Map<
        string,
        {
            resolve: (message: AgentMessage) => void;
            reject: (error: Error) => void;
            timeout: ReturnType<typeof setTimeout>;
        }
    >;

    constructor() {
        super();
        this.logger = new Logger('MessageBus');
        this.handlers = new Map();
        this.messageQueue = new Map();
        this.pendingReplies = new Map();
    }

    /**
     * Register an agent to receive messages
     */
    registerAgent(agentName: string, handler: MessageHandler): void {
        if (!this.handlers.has(agentName)) {
            this.handlers.set(agentName, []);
        }
        this.handlers.get(agentName)!.push(handler);

        // Process any queued messages
        this.processQueue(agentName);

        this.emit(MessageBusEvent.AGENT_REGISTERED, {
            agent: agentName,
            timestamp: Date.now(),
        });
        this.logger.info(`Agent registered: ${agentName}`);
    }

    /**
     * Unregister an agent from receiving messages
     */
    unregisterAgent(agentName: string): void {
        this.handlers.delete(agentName);
        this.emit(MessageBusEvent.AGENT_UNREGISTERED, {
            agent: agentName,
            timestamp: Date.now(),
        });
        this.logger.info(`Agent unregistered: ${agentName}`);
    }

    /**
     * Check if an agent is registered
     */
    isAgentRegistered(agentName: string): boolean {
        return this.handlers.has(agentName);
    }

    /**
     * Get list of registered agents
     */
    getRegisteredAgents(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Send a message from one agent to another
     */
    send(
        from: string,
        to: string | string[],
        content: string,
        options: SendMessageOptions = {},
    ): AgentMessage {
        const message: AgentMessage = {
            id: randomUUID(),
            from,
            to,
            type: options.type || 'notification',
            content,
            metadata: options.metadata,
            timestamp: Date.now(),
            replyTo: options.replyTo,
            priority: options.priority || 'normal',
        };

        this.emit(MessageBusEvent.MESSAGE_SENT, {
            message,
            timestamp: Date.now(),
        });

        // Handle multiple recipients
        const recipients = Array.isArray(to) ? to : [to];

        for (const recipient of recipients) {
            this.deliverMessage(message, recipient);
        }

        return message;
    }

    /**
     * Send a message and wait for a reply
     */
    async sendAndWait(
        from: string,
        to: string,
        content: string,
        options: SendMessageOptions = {},
        timeoutMs: number = 30000,
    ): Promise<AgentMessage> {
        // Ensure the sender is registered to receive the reply
        const wasRegistered = this.handlers.has(from);
        if (!wasRegistered) {
            // Register a temporary no-op handler
            this.handlers.set(from, []);
        }

        // Create the message but don't send yet
        const message: AgentMessage = {
            id: randomUUID(),
            from,
            to,
            type: options.type || 'request',
            content,
            metadata: options.metadata,
            timestamp: Date.now(),
            replyTo: options.replyTo,
            priority: options.priority || 'normal',
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingReplies.delete(message.id);
                // Clean up temporary registration
                if (!wasRegistered) {
                    this.handlers.delete(from);
                }
                reject(new Error(`Reply timeout for message ${message.id}`));
            }, timeoutMs);

            // Wrap resolve to clean up
            const wrappedResolve = (msg: AgentMessage) => {
                clearTimeout(timeout);
                if (!wasRegistered) {
                    this.handlers.delete(from);
                }
                resolve(msg);
            };

            // Set up the pending reply BEFORE sending the message
            this.pendingReplies.set(message.id, {
                resolve: wrappedResolve,
                reject,
                timeout,
            });

            // Now send the message
            this.emit(MessageBusEvent.MESSAGE_SENT, {
                message,
                timestamp: Date.now(),
            });

            // Deliver to recipients
            const recipients = Array.isArray(to) ? to : [to];
            for (const recipient of recipients) {
                this.deliverMessage(message, recipient);
            }
        });
    }

    /**
     * Broadcast a message to all registered agents
     */
    broadcast(
        from: string,
        content: string,
        options: Omit<SendMessageOptions, 'type'> = {},
    ): AgentMessage {
        const recipients = this.getRegisteredAgents().filter(
            (agent) => agent !== from,
        );
        return this.send(from, recipients, content, {
            ...options,
            type: 'broadcast',
        });
    }

    /**
     * Internal: Deliver a message to a specific recipient
     */
    private async deliverMessage(
        message: AgentMessage,
        recipient: string,
    ): Promise<void> {
        const handlers = this.handlers.get(recipient);

        // Only queue if agent is not registered (handlers is undefined)
        // Empty array means registered but no custom handlers (valid for sendAndWait)
        if (!handlers) {
            // Queue the message for later delivery
            if (!this.messageQueue.has(recipient)) {
                this.messageQueue.set(recipient, []);
            }
            this.messageQueue.get(recipient)!.push(message);
            this.logger.debug(`Message queued for offline agent: ${recipient}`);
            return;
        }

        this.emit(MessageBusEvent.MESSAGE_RECEIVED, {
            recipient,
            message,
            timestamp: Date.now(),
        });

        // Check if this message is a reply to a pending request
        if (message.type === 'response' && message.replyTo) {
            const pending = this.pendingReplies.get(message.replyTo);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve(message);
                this.pendingReplies.delete(message.replyTo);
            }
        }

        // Create reply function for this message
        const reply = (content: string, metadata?: Record<string, any>) => {
            this.send(recipient, message.from, content, {
                type: 'response',
                replyTo: message.id,
                metadata,
            });
        };

        const context: MessageHandlerContext = {
            message,
            reply,
        };

        // Call all handlers for this agent
        try {
            for (const handler of handlers) {
                await handler(context);
            }
            this.emit(MessageBusEvent.MESSAGE_DELIVERED, {
                recipient,
                messageId: message.id,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.logger.error(
                `Error delivering message to ${recipient}:`,
                error,
            );
            this.emit(MessageBusEvent.MESSAGE_FAILED, {
                recipient,
                messageId: message.id,
                error,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Internal: Process queued messages for a newly registered agent
     */
    private async processQueue(agentName: string): Promise<void> {
        const queued = this.messageQueue.get(agentName);
        if (!queued || queued.length === 0) return;

        this.logger.info(
            `Processing ${queued.length} queued messages for ${agentName}`,
        );

        // Clear queue first to avoid re-processing
        this.messageQueue.set(agentName, []);

        // Sort by priority and timestamp
        const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
        queued.sort((a, b) => {
            const aPriority = priorityOrder[a.priority || 'normal'];
            const bPriority = priorityOrder[b.priority || 'normal'];
            if (aPriority !== bPriority) return aPriority - bPriority;
            return a.timestamp - b.timestamp;
        });

        for (const message of queued) {
            await this.deliverMessage(message, agentName);
        }
    }

    /**
     * Get the number of pending messages in queue
     */
    getQueueLength(agentName: string): number {
        return this.messageQueue.get(agentName)?.length || 0;
    }

    /**
     * Clear all queued messages for an agent
     */
    clearQueue(agentName: string): void {
        this.messageQueue.delete(agentName);
    }

    /**
     * Clear all state (for testing)
     */
    reset(): void {
        this.handlers.clear();
        this.messageQueue.clear();
        for (const pending of this.pendingReplies.values()) {
            clearTimeout(pending.timeout);
        }
        this.pendingReplies.clear();
    }
}

// Singleton instance for default usage
let defaultBus: MessageBus | null = null;

export function getDefaultMessageBus(): MessageBus {
    if (!defaultBus) {
        defaultBus = new MessageBus();
    }
    return defaultBus;
}

export function resetDefaultMessageBus(): void {
    if (defaultBus) {
        defaultBus.reset();
        defaultBus = null;
    }
}

export default MessageBus;
