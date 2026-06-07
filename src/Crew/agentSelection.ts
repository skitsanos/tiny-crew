/**
 * Heuristic agent selection for Crew.
 *
 * Pure scoring helpers used to pick the best agent for a task before falling
 * back to an LLM. Kept separate so the heuristics are easy to test and tune.
 */

import type Agent from '@tinycrew/Agent';

export interface AgentPerformanceRecord {
    successCount: number;
    failureCount: number;
    lastTaskTypes: string[]; // Keywords from recent tasks
}

const STOP_WORDS = new Set([
    'a',
    'an',
    'the',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'as',
    'is',
    'was',
    'are',
    'were',
    'been',
    'be',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'shall',
    'can',
    'need',
    'it',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'we',
    'they',
]);

/** Extract meaningful lowercase keywords from a task description */
export function extractTaskKeywords(task: string): string[] {
    return task
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** True when a keyword and a candidate string overlap in either direction */
function overlaps(candidate: string, keyword: string): boolean {
    return candidate.includes(keyword) || keyword.includes(candidate);
}

/** Capability matching (strongest signal): +10 per matched keyword */
function scoreCapabilities(capabilities: string[], keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
        if (capabilities.some((cap) => overlaps(cap, keyword))) {
            score += 10;
        }
    }
    return score;
}

/** Tool matching: direct name overlap plus a few intent-based hints */
function scoreTools(toolNames: string[], keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
        if (toolNames.some((tool) => overlaps(tool, keyword))) {
            score += 8;
        }
        if (
            (keyword === 'save' || keyword === 'write') &&
            toolNames.some((t) => t.includes('file'))
        ) {
            score += 5;
        }
        if (
            (keyword === 'scrape' || keyword === 'fetch') &&
            toolNames.some((t) => t.includes('scrape') || t.includes('web'))
        ) {
            score += 5;
        }
    }
    return score;
}

/** Goal matching: +3 per keyword present in the agent's goal */
function scoreGoal(goalKeywords: string[], keywords: string[]): number {
    let score = 0;
    for (const keyword of keywords) {
        if (goalKeywords.includes(keyword)) {
            score += 3;
        }
    }
    return score;
}

/** Track record: success-rate bonus plus similarity to past task types */
function scorePerformance(
    perf: AgentPerformanceRecord | undefined,
    keywords: string[],
): number {
    if (!perf) return 0;

    const totalTasks = perf.successCount + perf.failureCount;
    if (totalTasks === 0) return 0;

    const successRate = perf.successCount / totalTasks;
    let score = Math.round(successRate * 5); // Up to 5 bonus points

    for (const keyword of keywords) {
        if (perf.lastTaskTypes.includes(keyword)) {
            score += 2;
        }
    }
    return score;
}

/** Combined heuristic score for assigning a task to an agent */
export function scoreAgentForTask(
    agent: Agent,
    taskKeywords: string[],
    perf: AgentPerformanceRecord | undefined,
): number {
    const capabilities = agent.getCapabilities().map((c) => c.toLowerCase());
    const toolNames = agent.getTools().map((t) => t.name.toLowerCase());
    const goalKeywords = extractTaskKeywords(agent.getGoal());

    return (
        scoreCapabilities(capabilities, taskKeywords) +
        scoreTools(toolNames, taskKeywords) +
        scoreGoal(goalKeywords, taskKeywords) +
        scorePerformance(perf, taskKeywords)
    );
}
