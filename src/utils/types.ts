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
    FAILED = 'failed',
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
    /** Preferred model for task execution (overrides ModelRouter for this agent) */
    preferredModel?: string;
    /**
     * Zod schema for structured output. When provided, the agent will use
     * OpenAI's Structured Outputs feature to ensure responses match the schema.
     * Use with zodTextFormat from 'openai/helpers/zod'.
     */
    responseSchema?: {
        schema: any; // Zod schema
        name: string; // Schema name for the API
    };
    /**
     * Maximum number of messages to keep in conversation history.
     * Older messages are removed when limit is exceeded.
     * Default: 50
     */
    maxHistoryMessages?: number;
    /**
     * Whether to automatically manage conversation history.
     * When true, the chat() method will maintain context across calls.
     * Default: true
     */
    autoManageHistory?: boolean;
    /**
     * Whether to enable automatic summarization of conversation history.
     * When enabled, old messages are summarized instead of being truncated.
     * Default: false
     */
    enableSummarization?: boolean;
    /**
     * Estimated token threshold that triggers automatic summarization.
     * When history exceeds this threshold, older messages are summarized.
     * Default: 3000
     */
    summarizationThreshold?: number;
    /**
     * Optional model to use for summarization (defaults to agent's model).
     * Can use a faster/cheaper model for summarization tasks.
     */
    summarizationModel?: string;
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
        additionalProperties?: boolean;
    };
}

export interface Tool {
    name: string;
    description: string;
    schema: ToolSchema;
    use: (args: any) => Promise<any>;
    validateInput?: (args: any) => boolean | Promise<boolean>;
    getCapabilities?: () => string[];
    annotateResult?: (result: any) => ToolResultMetadata;
}

export interface ToolResultMetadata {
    success: boolean;
    message?: string;
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

/**
 * Model purpose types for routing LLM calls to appropriate models
 * Different purposes can use different models for cost optimization
 */
export type ModelPurpose =
    | 'agent_selection' // Selecting which agent handles a task
    | 'task_execution' // Agent performing its assigned task
    | 'tool_synthesis' // Synthesizing results after tool use
    | 'final_response' // Generating final crew response
    | 'goal_achievement' // Summarizing for crew goal
    | 'reflection' // Agent self-reflection
    | 'summarization' // Summarization tasks
    | 'translation' // Translation tasks
    | 'planning'; // Task planning

/**
 * Configuration for ModelRouter
 */
export interface ModelRouterConfig {
    /** Default model used when no purpose-specific model is configured */
    defaultModel: string;
    /** Purpose-specific model overrides */
    models?: Partial<Record<ModelPurpose, string>>;
    /** Allowlist of valid model names (if set, warns when model not in list) */
    allowedModels?: string[];
    /** Warn when model doesn't match known patterns (default: true) */
    warnOnUnknown?: boolean;
}

// Events
export enum AgentEvent {
    TASK_STARTED = 'task_started',
    TASK_COMPLETED = 'task_completed',
    TASK_FAILED = 'task_failed',
    TOOL_USED = 'tool_used',
    MESSAGE_ADDED = 'message_added',
    HISTORY_CLEARED = 'history_cleared',
    HISTORY_TRIMMED = 'history_trimmed',
    HISTORY_SUMMARIZED = 'history_summarized',
    STREAM_CHUNK = 'stream_chunk',
    STREAM_END = 'stream_end',
    // Agent-to-agent messaging events
    MESSAGE_SENT = 'agent_message_sent',
    MESSAGE_RECEIVED = 'agent_message_received',
}

/**
 * Streaming chunk types for progressive response delivery
 */
export type StreamChunkType =
    | 'text'
    | 'tool_call_start'
    | 'tool_call_end'
    | 'done';

export interface StreamChunk {
    type: StreamChunkType;
    content?: string;
    toolName?: string;
    toolCallId?: string;
    isComplete: boolean;
}

export enum CrewEvent {
    TASK_ASSIGNED = 'task_assigned',
    MEMORY_UPDATED = 'memory_updated',
    GOAL_ACHIEVED = 'goal_achieved',
    GOAL_FAILED = 'goal_failed',
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

export type ConversationRole = 'system' | 'user' | 'assistant' | 'developer';

export interface ConversationMessage {
    role: ConversationRole;
    content: string;
    name?: string;
}

// Agent-to-Agent Messaging Types
export type AgentMessageType =
    | 'request' // Request for action or information
    | 'response' // Response to a request
    | 'notification' // One-way notification
    | 'handoff' // Transfer of task/conversation
    | 'broadcast'; // Message to multiple agents

export interface AgentMessage {
    id: string;
    from: string; // Sender agent name
    to: string | string[]; // Recipient agent name(s)
    type: AgentMessageType;
    content: string;
    metadata?: Record<string, any>;
    timestamp: number;
    replyTo?: string; // ID of message being replied to
    priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface MessageHandlerContext {
    message: AgentMessage;
    reply: (content: string, metadata?: Record<string, any>) => void;
}

export type MessageHandler = (
    context: MessageHandlerContext,
) => void | Promise<void>;
