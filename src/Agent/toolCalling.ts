/**
 * Tool-calling helpers shared by the Agent workflows.
 *
 * Pure functions for building Responses API tool definitions and instructions,
 * extracting tool calls from responses, and parsing tool arguments.
 */

import type { Tool } from '@tinycrew/utils/types';

export interface ExtractedToolCall {
    call_id: string;
    name: string;
    arguments: string;
}

export type ToolArgsResult =
    | { success: true; args: Record<string, any> }
    | { success: false; error: string; args: Record<string, any> };

/** Build strict Responses API function definitions for a set of tools */
export function buildToolDefinitions(tools: Map<string, Tool>): Array<any> {
    return Array.from(tools.values()).map((tool) => ({
        type: 'function' as const,
        name: tool.schema.name,
        description: tool.schema.description,
        parameters: {
            ...tool.schema.parameters,
            additionalProperties: false,
        },
        strict: true,
    }));
}

/** Render a human-readable instruction describing the available tools */
export function buildToolInstruction(tools: Map<string, Tool>): string {
    const instructions = Array.from(tools.values()).map(describeTool);

    instructions.push(
        'When calling a tool, always provide valid JSON arguments for every required parameter.',
    );

    if (tools.has('FileWrite')) {
        instructions.push(
            'When a task requires writing or saving content, you MUST call the FileWrite tool with a JSON object containing "filename" (including any directories) and "content" (the full text to write). Do not claim that a file was written unless the FileWrite tool call succeeds.',
        );
        instructions.push(
            'Example: {"name":"FileWrite","arguments":{"filename":"output/report.md","content":"# Report"}}',
        );
    }

    instructions.push(
        'After receiving tool outputs, you should incorporate their results and produce a final assistant message.',
    );

    return instructions.join('\n\n');
}

/** Describe a single tool and its parameters */
function describeTool(tool: Tool): string {
    const required = tool.schema.parameters.required ?? [];
    const properties = Object.entries(tool.schema.parameters.properties ?? {})
        .map(([key, value]: [string, any]) => {
            const requiredFlag = required.includes(key) ? ' (required)' : '';
            const description = value.description ?? 'no description provided';
            return `- ${key}${requiredFlag}: ${description}`;
        })
        .join('\n');

    return `Tool ${tool.schema.name}: ${tool.description}\nParameters:\n${properties}`;
}

/**
 * Extract tool calls from Responses API output items. Handles function_call
 * items (primary format) and message-embedded calls (compatibility).
 */
export function extractToolCalls(output: any[]): ExtractedToolCall[] {
    const toolCalls: ExtractedToolCall[] = [];

    for (const item of output) {
        if (item.type === 'function_call') {
            toolCalls.push({
                call_id: item.call_id,
                name: item.name,
                arguments: item.arguments,
            });
        } else if (item.type === 'message' && 'content' in item) {
            collectEmbeddedToolCalls(item.content ?? [], toolCalls);
        }
    }

    return toolCalls;
}

/** Collect tool calls embedded inside a message's content blocks */
function collectEmbeddedToolCalls(
    content: any[],
    toolCalls: ExtractedToolCall[],
): void {
    for (const block of content) {
        if (block.type !== 'tool_use' && block.type !== 'function_call') {
            continue;
        }
        toolCalls.push({
            call_id: block.id || block.call_id,
            name: block.name,
            arguments:
                typeof block.input === 'string'
                    ? block.input
                    : JSON.stringify(block.input || block.arguments || {}),
        });
    }
}

/** Parse tool arguments with explicit success/failure handling */
export function parseToolArguments(
    value: string | null | undefined,
): ToolArgsResult {
    if (!value || value.trim() === '') {
        return { success: true, args: {} };
    }

    try {
        return { success: true, args: JSON.parse(value) };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            // Fallback for backwards compatibility; caller should check success
            args: {},
        };
    }
}
