/**
 * Conversation state management for Agent.
 *
 * Owns the message history and rolling summary, plus the trim/auto-summarize
 * policy. The Agent delegates its public history methods here and injects a
 * `summarize` function (which closes over the OpenAI client + model choice).
 */

import type Logger from '@tinycrew/utils/logger';
import type { ConversationMessage } from '@tinycrew/utils/types';
import { AgentEvent } from '@tinycrew/utils/types';
import type { SummarizeResult } from './conversation';

type EmitFn = (event: AgentEvent, payload: Record<string, unknown>) => void;

export interface ConversationManagerOptions {
    agentName: string;
    logger: Logger;
    emit: EmitFn;
    maxHistoryMessages: number;
    autoManageHistory: boolean;
    enableSummarization: boolean;
    summarizationThreshold: number;
    /** Summarize older history, keeping the most recent `keepRecentCount` */
    summarize: (
        history: ConversationMessage[],
        existingSummary: string,
        keepRecentCount: number,
    ) => Promise<SummarizeResult>;
}

export class ConversationManager {
    private history: ConversationMessage[] = [];
    private summary = '';
    private readonly opts: ConversationManagerOptions;

    constructor(opts: ConversationManagerOptions) {
        this.opts = opts;
    }

    /** A copy of the current history */
    get(): ConversationMessage[] {
        return [...this.history];
    }

    length(): number {
        return this.history.length;
    }

    /** History to feed into the next task (excludes the just-added message) */
    historyForTask(): ConversationMessage[] {
        return this.opts.autoManageHistory ? this.history.slice(0, -1) : [];
    }

    clear(): void {
        const previousLength = this.history.length;
        this.history = [];
        this.opts.emit(AgentEvent.HISTORY_CLEARED, {
            agent: this.opts.agentName,
            previousLength,
            timestamp: Date.now(),
        });
        this.opts.logger.info(
            `Conversation history cleared (was ${previousLength} messages)`,
        );
    }

    /** Append a message, trimming/summarizing if over the limit */
    async add(message: ConversationMessage): Promise<void> {
        this.history.push(message);
        this.opts.emit(AgentEvent.MESSAGE_ADDED, {
            agent: this.opts.agentName,
            role: message.role,
            timestamp: Date.now(),
        });

        if (this.history.length > this.opts.maxHistoryMessages) {
            await this.trim();
        }
    }

    /**
     * Trim to maxHistoryMessages, preserving a leading system message. When
     * summarization is enabled and history is large, summarize instead.
     */
    private async trim(): Promise<void> {
        const toRemove = this.history.length - this.opts.maxHistoryMessages;
        if (toRemove <= 0) return;

        if (
            this.opts.enableSummarization &&
            this.estimateTokens() > this.opts.summarizationThreshold
        ) {
            await this.summarize();
            return;
        }

        const hasSystemFirst = this.history[0]?.role === 'system';
        const startIndex = hasSystemFirst ? 1 : 0;
        this.history.splice(startIndex, toRemove);

        this.opts.emit(AgentEvent.HISTORY_TRIMMED, {
            agent: this.opts.agentName,
            removedCount: toRemove,
            currentLength: this.history.length,
            timestamp: Date.now(),
        });
        this.opts.logger.debug(`Trimmed ${toRemove} messages from history`);
    }

    /** Rough token estimate (~4 chars/token) including the summary */
    estimateTokens(): number {
        let totalChars = this.summary.length;
        for (const message of this.history) {
            totalChars += message.content.length;
        }
        return Math.ceil(totalChars / 4);
    }

    /** Summarize older history, keeping the most recent `keepRecentCount` */
    async summarize(keepRecentCount = 10): Promise<string> {
        const result = await this.opts.summarize(
            this.history,
            this.summary,
            keepRecentCount,
        );

        this.history = result.history;

        if (result.didSummarize) {
            this.summary = result.summary;
            this.opts.emit(AgentEvent.HISTORY_SUMMARIZED, {
                agent: this.opts.agentName,
                previousLength: result.previousLength,
                newLength: this.history.length,
                summarizedCount: result.summarizedCount,
                summaryLength: result.summary.length,
                timestamp: Date.now(),
            });
        }

        return result.summary;
    }

    getSummary(): string {
        return this.summary;
    }

    setSummary(summary: string): void {
        this.summary = summary;
    }

    isSummarizationEnabled(): boolean {
        return this.opts.enableSummarization;
    }

    set(history: ConversationMessage[]): void {
        this.history = [...history];
        this.opts.logger.info(
            `Conversation history set to ${history.length} messages`,
        );
    }
}
