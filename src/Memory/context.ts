/**
 * Context-string building for MemoryStore.
 *
 * Turns a set of memory items into a token-budgeted Markdown digest that can be
 * injected into an agent prompt.
 */

import type { MemoryItem } from './types';
import { estimateTokens } from './types';

export interface BuildContextOptions {
    maxTokens: number;
    includeTimestamps: boolean;
    summarizeThreshold: number;
}

/** Format a single memory item as a Markdown entry */
function formatEntry(
    item: MemoryItem,
    content: string,
    includeTimestamps: boolean,
): string {
    const ellipsis = item.task.length > 100 ? '...' : '';
    const title = `### ${item.agent}: ${item.task.slice(0, 100)}${ellipsis}\n`;
    const timestamp = includeTimestamps
        ? `*${new Date(item.createdAt).toISOString()}*\n`
        : '';
    return `${title}${timestamp}${content}\n\n`;
}

/** Pick the stored summary when the full result is large enough to warrant it */
function selectContent(item: MemoryItem, summarizeThreshold: number): string {
    return item.summary && item.tokenCount > summarizeThreshold
        ? item.summary
        : item.result;
}

/**
 * Build a token-budgeted context string from memory items. The last entry is
 * truncated (rather than dropped) when there is meaningful room left.
 */
export function buildContextString(
    items: MemoryItem[],
    options: BuildContextOptions,
): string {
    if (items.length === 0) {
        return '';
    }

    const lines: string[] = ['## Previous Task Results\n'];
    let tokenCount = estimateTokens(lines[0]);

    for (const item of items) {
        const content = selectContent(item, options.summarizeThreshold);
        const entry = formatEntry(item, content, options.includeTimestamps);
        const entryTokens = estimateTokens(entry);

        if (tokenCount + entryTokens <= options.maxTokens) {
            lines.push(entry);
            tokenCount += entryTokens;
            continue;
        }

        // Over budget: try to fit a truncated version of this entry, then stop.
        const availableTokens = options.maxTokens - tokenCount - 100; // buffer
        if (availableTokens > 200) {
            const truncated = `${content.slice(0, availableTokens * 4)}...`;
            lines.push(formatEntry(item, truncated, options.includeTimestamps));
        }
        break;
    }

    return lines.join('');
}
