/**
 * Shared helpers for building OpenAI Responses API input items and reading
 * text back out of responses. Used by both Agent and Crew.
 */

import { randomUUID } from 'node:crypto';
import type { ConversationMessage } from '@tinycrew/utils/types';
import type {
    Response,
    ResponseInputItem,
    ResponseOutputMessage,
} from 'openai/resources/responses/responses';

/** Build a user/system/developer input message */
export function buildMessage(
    role: 'system' | 'user' | 'developer',
    content: string,
): ResponseInputItem {
    return {
        type: 'message',
        role,
        content: [
            {
                type: 'input_text',
                text: content,
            },
        ],
    };
}

/** Build an assistant output message (for replaying prior turns) */
export function buildAssistantOutput(content: string): ResponseOutputMessage {
    return {
        id: `msg_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [
            {
                type: 'output_text',
                text: content,
                annotations: [],
                logprobs: [],
            },
        ],
    };
}

/** Convert a stored conversation message into a Responses API input item */
export function toResponseInputItem(
    message: ConversationMessage,
): ResponseInputItem {
    if (message.role === 'assistant') {
        return buildAssistantOutput(message.content);
    }

    if (message.role === 'developer') {
        return buildMessage('developer', message.content);
    }

    return buildMessage(message.role, message.content);
}

/** Extract plain text from a response, falling back to message content blocks */
export function extractTextFromResponse(response: Response): string {
    if (response.output_text && response.output_text.trim().length > 0) {
        return response.output_text;
    }

    const texts: string[] = [];
    for (const item of response.output ?? []) {
        if (item.type === 'message') {
            for (const content of item.content) {
                if (content.type === 'output_text') {
                    texts.push(content.text);
                }
            }
        }
    }

    return texts.join('\n').trim();
}
