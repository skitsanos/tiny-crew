/**
 * Streaming helpers for Agent.
 *
 * Accumulates tool-call information from the Responses API streaming events.
 * Text deltas are handled by the Agent (which yields them); everything else is
 * folded into a StreamState here.
 */

import type { ExtractedToolCall } from './toolCalling';

export interface StreamState {
    fullText: string;
    responseId?: string;
    toolCalls: ExtractedToolCall[];
    /** Function calls being assembled across argument-delta events */
    pending: Map<string, { name: string; arguments: string }>;
}

/** Create an empty stream-accumulation state */
export function createStreamState(): StreamState {
    return {
        fullText: '',
        responseId: undefined,
        toolCalls: [],
        pending: new Map(),
    };
}

/** Fold a non-text streaming event into the tool-call accumulation state */
export function accumulateStreamToolCalls(
    event: any,
    state: StreamState,
): void {
    switch (event.type) {
        case 'response.function_call_arguments.delta':
            appendArguments(event, state);
            break;
        case 'response.output_item.added':
            startCall(event, state);
            break;
        case 'response.output_item.done':
            finishCall(event, state);
            break;
        case 'response.completed':
        case 'response.done':
            captureFinal(event, state);
            break;
    }
}

function appendArguments(event: any, state: StreamState): void {
    const callId = event.call_id || event.item_id;
    if (!callId) return;

    const existing = state.pending.get(callId) || { name: '', arguments: '' };
    existing.arguments += event.delta || '';
    state.pending.set(callId, existing);
}

function startCall(event: any, state: StreamState): void {
    if (event.item?.type !== 'function_call') return;

    const callId = event.item.call_id || event.item.id;
    state.pending.set(callId, { name: event.item.name || '', arguments: '' });
}

function finishCall(event: any, state: StreamState): void {
    if (event.item?.type !== 'function_call') return;

    const callId = event.item.call_id || event.item.id;
    const pending = state.pending.get(callId);
    state.toolCalls.push({
        call_id: callId,
        name: event.item.name || pending?.name || '',
        arguments: event.item.arguments || pending?.arguments || '',
    });
    state.pending.delete(callId);
}

function captureFinal(event: any, state: StreamState): void {
    if (event.response?.id) {
        state.responseId = event.response.id;
    }
    for (const item of event.response?.output ?? []) {
        if (
            item.type === 'function_call' &&
            !state.toolCalls.find((tc) => tc.call_id === item.call_id)
        ) {
            state.toolCalls.push({
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments,
            });
        }
    }
}
