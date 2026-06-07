/**
 * Agent-to-agent messaging for Agent.
 *
 * Owns the message-bus connection and the registered inbound handlers. The
 * Agent delegates its public messaging methods here and supplies an `emit`
 * callback so message events still surface on the Agent's EventEmitter.
 */

import type Logger from '@tinycrew/utils/logger';
import type { AgentMessage, MessageHandler } from '@tinycrew/utils/types';
import { AgentEvent } from '@tinycrew/utils/types';
import type { MessageBus, SendMessageOptions } from './MessageBus';

type EmitFn = (event: AgentEvent, payload: Record<string, unknown>) => void;

export class AgentMessaging {
    private bus: MessageBus | null = null;
    private readonly handlers: MessageHandler[] = [];

    constructor(
        private readonly agentName: string,
        private readonly logger: Logger,
        private readonly emit: EmitFn,
    ) {}

    /** Connect to a bus; replaces any existing connection */
    connect(bus: MessageBus): void {
        if (this.bus) {
            this.disconnect();
        }

        this.bus = bus;

        bus.registerAgent(this.agentName, async (ctx) => {
            this.emit(AgentEvent.MESSAGE_RECEIVED, {
                agent: this.agentName,
                from: ctx.message.from,
                message: ctx.message,
                timestamp: Date.now(),
            });

            for (const handler of this.handlers) {
                await handler(ctx);
            }
        });

        this.logger.info('Connected to message bus');
    }

    disconnect(): void {
        if (this.bus) {
            this.bus.unregisterAgent(this.agentName);
            this.bus = null;
            this.logger.info('Disconnected from message bus');
        }
    }

    isConnected(): boolean {
        return this.bus !== null;
    }

    /** Send a message to one or more agents */
    send(
        to: string | string[],
        content: string,
        options: SendMessageOptions = {},
    ): AgentMessage {
        const message = this.requireBus().send(
            this.agentName,
            to,
            content,
            options,
        );

        this.emit(AgentEvent.MESSAGE_SENT, {
            agent: this.agentName,
            to,
            message,
            timestamp: Date.now(),
        });

        return message;
    }

    /** Send a message and await a reply (request/response) */
    sendAndWait(
        to: string,
        content: string,
        options: SendMessageOptions = {},
        timeoutMs = 30000,
    ): Promise<AgentMessage> {
        return this.requireBus().sendAndWait(
            this.agentName,
            to,
            content,
            options,
            timeoutMs,
        );
    }

    /** Broadcast a message to all agents on the bus */
    broadcast(
        content: string,
        options: Omit<SendMessageOptions, 'type'> = {},
    ): AgentMessage {
        return this.requireBus().broadcast(this.agentName, content, options);
    }

    /** Register an inbound message handler; returns an unsubscribe function */
    onMessage(handler: MessageHandler): () => void {
        this.handlers.push(handler);
        return () => {
            const index = this.handlers.indexOf(handler);
            if (index !== -1) {
                this.handlers.splice(index, 1);
            }
        };
    }

    handlerCount(): number {
        return this.handlers.length;
    }

    private requireBus(): MessageBus {
        if (!this.bus) {
            throw new Error('Agent is not connected to a message bus');
        }
        return this.bus;
    }
}
