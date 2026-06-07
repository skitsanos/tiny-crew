/**
 * LLM synthesis helpers for Crew.
 *
 * Pure with respect to Crew state: each function gathers task results from
 * memory, builds a prompt, calls the model, and returns the text. The Crew
 * keeps the side effects (storing results, updating chat history, events).
 */

import type { MemoryStore } from '@tinycrew/Memory';
import type { ModelRouter } from '@tinycrew/ModelRouter';
import type Logger from '@tinycrew/utils/logger';
import {
    buildMessage,
    extractTextFromResponse,
    toResponseInputItem,
} from '@tinycrew/utils/responseHelpers';
import { withRetry } from '@tinycrew/utils/retry';
import type { ConversationMessage } from '@tinycrew/utils/types';
import type OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

export interface SynthesisDeps {
    client: OpenAI;
    modelRouter: ModelRouter;
    memoryStore: MemoryStore;
    logger: Logger;
    crewId: string;
    goal: string;
    /** Optional generation params (temperature/max_output_tokens/reasoning) */
    generationParams: Record<string, unknown>;
}

/** Concatenate all stored task results into a prompt-ready block */
async function gatherResults(deps: SynthesisDeps): Promise<string> {
    const memoryItems = await deps.memoryStore.query(deps.crewId, {
        sortBy: 'recency',
        maxItems: 100,
    });

    return memoryItems
        .map(
            (item) =>
                `Task: ${item.task}\nAgent: ${item.agent}\nResult: ${item.result}`,
        )
        .join('\n\n');
}

/** Generate the crew's final answer from accumulated task results */
export async function generateFinalResponse(
    deps: SynthesisDeps,
    chatHistory: ConversationMessage[],
    instruction: string,
): Promise<string> {
    const allResults = await gatherResults(deps);

    const finalAnswerPrompt = `
    Crew Goal: "${deps.goal}"

    Here are the results of the individual tasks:

    ${allResults}

    ${instruction}
    `;

    const input: ResponseInputItem[] = [
        ...chatHistory.map((message) => toResponseInputItem(message)),
        buildMessage('user', finalAnswerPrompt),
    ];

    const response = await withRetry(
        () =>
            deps.client.responses.create({
                model: deps.modelRouter.getModel('final_response'),
                input,
                ...deps.generationParams,
            }),
        deps.logger,
        'crew:final-response',
    );

    return extractTextFromResponse(response);
}

/** Generate a comprehensive summary addressing the crew goal */
export async function generateGoalSummary(
    deps: SynthesisDeps,
    summarizationPrompt: string,
): Promise<string> {
    const allResults = await gatherResults(deps);

    const summaryPrompt = summarizationPrompt
        .replace('{goal}', deps.goal)
        .replace('{results}', allResults);

    const response = await withRetry(
        () =>
            deps.client.responses.create({
                model: deps.modelRouter.getModel('goal_achievement'),
                input: [buildMessage('user', summaryPrompt)],
                ...deps.generationParams,
            }),
        deps.logger,
        'crew:summary',
    );

    return extractTextFromResponse(response);
}
