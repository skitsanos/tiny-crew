/**
 * Core type definitions for the TinyCrew framework
 */

// Task-related interfaces
export interface TaskResult {
    agent: string;
    task: string;
    result: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface TaskError {
    agent: string;
    task: string;
    error: Error;
    timestamp: number;
    metadata?: Record<string, any>;
}

export enum TaskStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export interface Task {
    id: string;
    description: string;
    status: TaskStatus;
    assignedAgent?: string;
    result?: string;
    error?: Error;
    createdAt: number;
    updatedAt: number;
    priority?: number;
    dependencies?: string[]; // IDs of tasks that must be completed first
    metadata?: Record<string, any>;
}

// Agent configuration interfaces
export interface AgentConfig {
    name: string;
    model?: string;
    goal: string;
    expectedOutput?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    capabilities?: string[]; // What this agent is good at
    metadata?: Record<string, any>;
}

// Tool-related interfaces
export interface ToolParameter {
    type: string;
    description: string;
    enum?: any[];
    default?: any;
    minimum?: number;
    maximum?: number;
    format?: string;
    pattern?: string;
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: {
            [key: string]: ToolParameter;
        };
        required: string[];
    };
}

export interface Tool {
    name: string;
    description: string;
    schema: ToolSchema;
    use: (args: any) => Promise<any>;
    validateInput?: (args: any) => boolean | Promise<boolean>;
    getCapabilities?: () => string[];
}

// Crew-related interfaces
export interface CrewConfig {
    goal: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    summarizationPrompt?: string;
    taskAssignmentPrompt?: string;
    metadata?: Record<string, any>;
}

// Memory-related interfaces
export interface MemoryItem {
    key: string;
    value: any;
    agent: string;
    timestamp: number;
    metadata?: Record<string, any>;
}

export interface SharedMemory {
    [key: string]: MemoryItem;
}

// LLM-related interfaces
export interface LlmConfig {
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    metadata?: Record<string, any>;
}

// Events
export enum AgentEvent {
    TASK_STARTED = 'task_started',
    TASK_COMPLETED = 'task_completed',
    TASK_FAILED = 'task_failed',
    TOOL_USED = 'tool_used'
}

export enum CrewEvent {
    TASK_ASSIGNED = 'task_assigned',
    MEMORY_UPDATED = 'memory_updated',
    GOAL_ACHIEVED = 'goal_achieved',
    GOAL_FAILED = 'goal_failed'
}

// Interface for plugins to extend functionality
export interface TinyCrewPlugin {
    name: string;
    description: string;
    initialize: (context: any) => Promise<void>;
    hooks: {
        [key: string]: (...args: any[]) => any | Promise<any>;
    };
}