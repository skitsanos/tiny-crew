/**
 * Conversation summarization for Agent.
 *
 * Compresses older history into a summary while preserving the most recent
 * messages, so multi-turn chats stay within the model's context budget.
 */

import type Logger from '@tinycrew/utils/logger';
import {
    buildMessage,
    extractTextFromResponse,
} from '@tinycrew/utils/responseHelpers';
import { withRetry } from '@tinycrew/utils/retry';
import type { ConversationMessage } from '@tinycrew/utils/types';
import dedent from 'dedent';
import type OpenAI from 'openai';

const SUMMARY_PREFIX = '[Previous conversation summary:';

export interface SummarizeParams {
    history: ConversationMessage[];
    existingSummary: string;
    keepRecentCount: number;
    client: OpenAI;
    model: string;
    temperature?: number;
    logger: Logger;
    agentName: string;
}

export interface SummarizeResult {
    /** The summary text (new on success, otherwise the existing summary) */
    summary: string;
    /** History to apply (rebuilt on success, trimmed on failure, else as-is) */
    history: ConversationMessage[];
    /** Whether a new summary was produced and history rebuilt */
    didSummarize: boolean;
    /** Number of messages folded into the summary (0 when not summarized) */
    summarizedCount: number;
    /** History length before summarization (for event reporting) */
    previousLength: number;
}

function isSummaryMessage(message: ConversationMessage): boolean {
    return (
        message.role === 'system' && message.content.startsWith(SUMMARY_PREFIX)
    );
}

function buildSummarizationPrompt(
    messagesToSummarize: ConversationMessage[],
    existingSummary: string,
): string {
    const conversationText = messagesToSummarize
        .filter((m) => !isSummaryMessage(m))
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n');

    const existingSummaryContext = existingSummary
        ? `Previous conversation summary:\n${existingSummary}\n\n`
        : '';

    return dedent`
        ${existingSummaryContext}Summarize the following conversation, preserving:
        - Key topics discussed
        - Important decisions or conclusions
        - Any commitments or action items
        - Relevant context for continuing the conversation

        Be concise but comprehensive. The summary will be used to maintain context in future turns.

        CONVERSATION:
        ${conversationText}

        SUMMARY:
    `;
}

function rebuildHistory(
    history: ConversationMessage[],
    hasSystemFirst: boolean,
    messagesToKeep: ConversationMessage[],
    summary: string,
): ConversationMessage[] {
    const newHistory: ConversationMessage[] = [];

    if (hasSystemFirst) {
        newHistory.push(history[0]);
    }

    newHistory.push({
        role: 'system',
        content: `${SUMMARY_PREFIX} ${summary}]`,
    });

    // Drop any prior summary messages so they don't stack over time
    newHistory.push(...messagesToKeep.filter((m) => !isSummaryMessage(m)));

    return newHistory;
}

/**
 * Summarize older conversation history, keeping the most recent messages.
 * Pure with respect to Agent state: returns the result for the caller to apply.
 */
export async function summarizeConversation(
    params: SummarizeParams,
): Promise<SummarizeResult> {
    const { history, existingSummary, keepRecentCount, logger } = params;

    const unchanged: SummarizeResult = {
        summary: existingSummary,
        history,
        didSummarize: false,
        summarizedCount: 0,
        previousLength: history.length,
    };

    if (history.length <= keepRecentCount) {
        logger.debug('Not enough history to summarize');
        return unchanged;
    }

    const hasSystemFirst = history[0]?.role === 'system';
    const startIndex = hasSystemFirst ? 1 : 0;
    const messagesToKeep = history.slice(-keepRecentCount);
    const messagesToSummarize = history.slice(
        startIndex,
        history.length - keepRecentCount,
    );

    if (messagesToSummarize.length === 0) {
        logger.debug(
            'No messages to summarize after preserving system message',
        );
        return unchanged;
    }

    const prompt = buildSummarizationPrompt(
        messagesToSummarize,
        existingSummary,
    );

    try {
        const response = await withRetry(
            () =>
                params.client.responses.create({
                    model: params.model,
                    input: [
                        buildMessage(
                            'system',
                            'You are a helpful assistant that creates concise conversation summaries.',
                        ),
                        buildMessage('user', prompt),
                    ],
                    ...(params.temperature !== undefined
                        ? { temperature: params.temperature }
                        : {}),
                }),
            logger,
            `summarization (${params.agentName})`,
        );

        const summary = extractTextFromResponse(response);
        if (!summary) {
            return unchanged;
        }

        const newHistory = rebuildHistory(
            history,
            hasSystemFirst,
            messagesToKeep,
            summary,
        );

        logger.info(
            `Summarized ${messagesToSummarize.length} messages into ${summary.length} chars, ` +
                `history reduced from ${history.length} to ${newHistory.length} messages`,
        );

        return {
            summary,
            history: newHistory,
            didSummarize: true,
            summarizedCount: messagesToSummarize.length,
            previousLength: history.length,
        };
    } catch (error) {
        logger.error('Error during summarization:', error);
        // Fall back to simple trimming if summarization fails
        return {
            ...unchanged,
            history: [
                ...(hasSystemFirst ? [history[0]] : []),
                ...messagesToKeep,
            ],
        };
    }
}
