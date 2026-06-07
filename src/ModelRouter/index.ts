/**
 * ModelRouter - Routes LLM calls to appropriate models based on purpose
 *
 * Enables cost optimization by using cheaper models for routine tasks
 * and more capable models for complex reasoning.
 */

import type { ModelPurpose, ModelRouterConfig } from '@tinycrew/utils/types';

/**
 * Environment variable names for each model purpose
 */
const ENV_VAR_MAP: Record<ModelPurpose, string> = {
    agent_selection: 'MODEL_AGENT_SELECTION',
    task_execution: 'MODEL_TASK_EXECUTION',
    tool_synthesis: 'MODEL_TOOL_SYNTHESIS',
    final_response: 'MODEL_FINAL_RESPONSE',
    goal_achievement: 'MODEL_GOAL_ACHIEVEMENT',
    reflection: 'MODEL_REFLECTION',
    summarization: 'MODEL_SUMMARIZATION',
    translation: 'MODEL_TRANSLATION',
    planning: 'MODEL_PLANNING',
};

const DEFAULT_MODEL_FALLBACK = 'gpt-4o-mini';

/**
 * Common model patterns for validation warnings
 */
const KNOWN_MODEL_PATTERNS = [
    /^gpt-\d/, // gpt-3.5, gpt-4, gpt-4o, gpt-5.x, ...
    /^o\d/, // o1, o3, o4, ... reasoning models
    /^claude/,
    /^gemini/,
    /^llama/,
    /^mistral/,
    /^codellama/,
];

export class ModelRouter {
    private readonly defaultModel: string;
    private readonly purposeModels: Map<ModelPurpose, string>;
    private readonly allowedModels?: Set<string>;
    private readonly warnOnUnknown: boolean;

    constructor(config?: ModelRouterConfig) {
        this.warnOnUnknown = config?.warnOnUnknown ?? true;
        this.allowedModels = config?.allowedModels
            ? new Set(config.allowedModels)
            : undefined;

        // Validate and set default model
        const defaultModel = config?.defaultModel || DEFAULT_MODEL_FALLBACK;
        this.defaultModel =
            this.validateModel(defaultModel, 'defaultModel') ||
            DEFAULT_MODEL_FALLBACK;

        this.purposeModels = new Map();

        if (config?.models) {
            for (const [purpose, model] of Object.entries(config.models)) {
                if (model) {
                    const validated = this.validateModel(model, purpose);
                    if (validated) {
                        this.purposeModels.set(
                            purpose as ModelPurpose,
                            validated,
                        );
                    }
                }
            }
        }
    }

    /**
     * Validate a model name
     * Returns the trimmed model name if valid, or null if invalid
     */
    private validateModel(model: string, source: string): string | null {
        // Check for empty or whitespace-only strings
        const trimmed = model.trim();
        if (!trimmed) {
            console.warn(
                `[ModelRouter] Empty model name provided for ${source}, ignoring`,
            );
            return null;
        }

        // Check against allowlist if provided
        if (this.allowedModels && !this.allowedModels.has(trimmed)) {
            console.warn(
                `[ModelRouter] Model "${trimmed}" for ${source} is not in allowed list`,
            );
        }
        // If no allowlist, warn on unknown patterns
        else if (this.warnOnUnknown && !this.allowedModels) {
            const isKnown = KNOWN_MODEL_PATTERNS.some((pattern) =>
                pattern.test(trimmed),
            );
            if (!isKnown) {
                console.warn(
                    `[ModelRouter] Model "${trimmed}" for ${source} doesn't match known patterns - verify spelling`,
                );
            }
        }

        return trimmed;
    }

    /**
     * Create a ModelRouter from environment variables
     *
     * Reads:
     * - DEFAULT_MODEL: Fallback model for all purposes
     * - MODEL_AGENT_SELECTION: Model for agent selection
     * - MODEL_TASK_EXECUTION: Model for task execution
     * - MODEL_TOOL_SYNTHESIS: Model for tool synthesis
     * - MODEL_FINAL_RESPONSE: Model for final responses
     * - MODEL_GOAL_ACHIEVEMENT: Model for goal achievement
     * - MODEL_REFLECTION: Model for agent reflection
     * - MODEL_SUMMARIZATION: Model for summarization
     * - MODEL_TRANSLATION: Model for translation
     * - MODEL_PLANNING: Model for planning
     */
    static fromEnv(): ModelRouter {
        const defaultModel =
            process.env.DEFAULT_MODEL || DEFAULT_MODEL_FALLBACK;
        const models: Partial<Record<ModelPurpose, string>> = {};

        for (const [purpose, envVar] of Object.entries(ENV_VAR_MAP)) {
            const model = process.env[envVar];
            if (model) {
                models[purpose as ModelPurpose] = model;
            }
        }

        return new ModelRouter({ defaultModel, models });
    }

    /**
     * Get the model for a specific purpose
     * Falls back to defaultModel if no specific model is configured
     */
    getModel(purpose: ModelPurpose): string {
        return this.purposeModels.get(purpose) ?? this.defaultModel;
    }

    /**
     * Resolve the model to use, allowing for explicit override
     *
     * Priority:
     * 1. Explicit override (if provided)
     * 2. Purpose-specific model (if configured)
     * 3. Default model
     */
    resolveModel(purpose: ModelPurpose, override?: string): string {
        if (override) {
            return override;
        }
        return this.getModel(purpose);
    }

    /**
     * Get the default model
     */
    getDefaultModel(): string {
        return this.defaultModel;
    }

    /**
     * Check if a specific model is configured for a purpose
     */
    hasModelFor(purpose: ModelPurpose): boolean {
        return this.purposeModels.has(purpose);
    }

    /**
     * Get all configured purpose-model mappings
     */
    getConfiguredModels(): Record<string, string> {
        const result: Record<string, string> = {
            default: this.defaultModel,
        };
        for (const [purpose, model] of this.purposeModels) {
            result[purpose] = model;
        }
        return result;
    }
}

export default ModelRouter;
