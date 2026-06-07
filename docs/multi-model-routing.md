# Multi-Model Routing

TinyCrew supports routing different LLM operations to different models based on their purpose. This enables cost optimization by using cheaper/faster models for routine tasks while reserving more capable models for complex reasoning.

## Overview

Different operations have different requirements:
- **Agent selection** needs to be fast and cheap (runs frequently)
- **Task execution** needs capability (core work)
- **Reflection** can use a cheaper model (self-analysis)

Multi-model routing lets you optimize for both cost and quality.

## Model Purposes

| Purpose | Description | Recommended Model |
|---------|-------------|-------------------|
| `agent_selection` | Selecting which agent handles a task | `gpt-4o-mini` |
| `task_execution` | Agent task execution | `gpt-4o` |
| `tool_synthesis` | Synthesizing tool outputs into responses | `gpt-4o` |
| `final_response` | Crew's final response generation | `gpt-4o` |
| `goal_achievement` | Crew goal summary | `gpt-4o` |
| `reflection` | Agent self-reflection | `gpt-4o-mini` |
| `summarization` | Text summarization tasks | `gpt-4o-mini` |
| `translation` | Text translation tasks | `gpt-4o-mini` |
| `planning` | Task planning | `gpt-4o` |

## Configuration Methods

### 1. Environment Variables (Simplest)

Set environment variables for automatic configuration:

```bash
# .env file
DEFAULT_MODEL=gpt-4o                    # Fallback for all purposes
MODEL_AGENT_SELECTION=gpt-4o-mini       # Cheap model for agent selection
MODEL_TASK_EXECUTION=gpt-4o             # Capable model for task work
MODEL_TOOL_SYNTHESIS=gpt-4o             # Synthesizing tool outputs
MODEL_FINAL_RESPONSE=gpt-4o             # Crew final response
MODEL_GOAL_ACHIEVEMENT=gpt-4o           # Crew goal summary
MODEL_REFLECTION=gpt-4o-mini            # Cheap model for reflection
MODEL_SUMMARIZATION=gpt-4o-mini         # Summarization tasks
MODEL_TRANSLATION=gpt-4o-mini           # Translation tasks
MODEL_PLANNING=gpt-4o                   # Task planning
```

TinyCrew automatically loads these when creating a Crew:

```typescript
// Automatically uses ModelRouter.fromEnv()
const crew = new Crew({ goal: 'Research AI trends' }, openai);
```

### 2. Programmatic Configuration

For more control, create a `ModelRouter` explicitly:

```typescript
import { Crew, ModelRouter } from 'tiny-crew';

const router = new ModelRouter({
    defaultModel: 'gpt-4o',
    models: {
        agent_selection: 'gpt-4o-mini',
        reflection: 'gpt-4o-mini',
        task_execution: 'gpt-4o'
    }
});

const crew = new Crew(
    { goal: 'Research AI trends' },
    openai,
    [],  // chatHistory
    { modelRouter: router }
);
```

### 3. Per-Agent Model Override

Individual agents can specify a `preferredModel` that overrides the router:

```typescript
const cheapAgent = new Agent({
    name: 'Summarizer',
    goal: 'Summarize content quickly',
    preferredModel: 'gpt-4o-mini',  // Always uses mini for task execution
    capabilities: ['summarization']
}, openai);

const powerAgent = new Agent({
    name: 'Analyst',
    goal: 'Deep analysis requiring strong reasoning',
    preferredModel: 'gpt-4o',  // Uses more capable model
    capabilities: ['analysis', 'reasoning']
}, openai);

crew.addAgent(cheapAgent);
crew.addAgent(powerAgent);
```

> **Note:** `preferredModel` only affects `task_execution` and `tool_synthesis` purposes. Other purposes (like `reflection`) still use the router.

## Model Resolution Priority

When determining which model to use for an operation:

1. **Agent's preferredModel** (for task_execution/tool_synthesis only)
2. **ModelRouter's purpose-specific model** (if configured)
3. **ModelRouter's defaultModel**
4. **Hardcoded fallback**: `gpt-4o-mini`

## Default Model Fallback

When no environment variables are set and no explicit configuration is provided, TinyCrew uses `gpt-4o-mini` as the hardcoded fallback. This ensures the system works out of the box without configuration.

**Complete fallback chain:**
1. Purpose-specific env var (e.g., `MODEL_TASK_EXECUTION`)
2. `DEFAULT_MODEL` env var
3. Hardcoded fallback: `gpt-4o-mini`

## Model Name Validation

ModelRouter accepts any non-empty model name as-is — the OpenAI API is the
source of truth for whether a model exists and reports unknown models clearly.
Empty/whitespace names are ignored and fall back to the default.

### Restricting models with an allowlist

To guard against accidental use of unexpected (e.g. expensive) models, pass an
`allowedModels` list. Models outside the list are still used but trigger a
warning:

```typescript
const router = new ModelRouter({
    defaultModel: 'gpt-5-mini',
    allowedModels: ['gpt-5-mini', 'gpt-5-nano'],
});
// Console (if a model outside the list is configured):
// [ModelRouter] Model "gpt-5" for <purpose> is not in allowed list
```

### Using an Allowlist

For strict validation:

```typescript
const router = new ModelRouter({
    defaultModel: 'gpt-4o',
    allowedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
});
// Warns if any configured model is not in the allowlist
```

## Cost Optimization Strategy

A typical cost-optimized configuration:

```bash
# Use mini for routine, deterministic tasks
MODEL_AGENT_SELECTION=gpt-4o-mini
MODEL_REFLECTION=gpt-4o-mini
MODEL_SUMMARIZATION=gpt-4o-mini

# Use capable model for complex reasoning
MODEL_TASK_EXECUTION=gpt-4o
MODEL_FINAL_RESPONSE=gpt-4o
MODEL_GOAL_ACHIEVEMENT=gpt-4o
MODEL_PLANNING=gpt-4o

# Fallback
DEFAULT_MODEL=gpt-4o
```

**Expected savings:** 50-70% reduction on routine operations while maintaining quality for complex tasks.

### Cost Breakdown Example

For a typical workflow with 10 tasks:

| Operation | Count | Without Routing | With Routing |
|-----------|-------|-----------------|--------------|
| Agent Selection | 10 | gpt-4o | gpt-4o-mini |
| Task Execution | 10 | gpt-4o | gpt-4o |
| Reflection | 10 | gpt-4o | gpt-4o-mini |
| Final Response | 1 | gpt-4o | gpt-4o |

With routing, you use the cheaper model for 20 of 31 LLM calls.

## API Reference

### ModelRouter Class

```typescript
class ModelRouter {
    constructor(config?: ModelRouterConfig);

    // Create from environment variables
    static fromEnv(): ModelRouter;

    // Get model for a specific purpose
    getModel(purpose: ModelPurpose): string;

    // Resolve model with optional override
    resolveModel(purpose: ModelPurpose, override?: string): string;

    // Get the default model
    getDefaultModel(): string;

    // Check if a specific model is configured for a purpose
    hasModelFor(purpose: ModelPurpose): boolean;

    // Get all configured purpose-model mappings
    getConfiguredModels(): Record<string, string>;
}
```

### ModelRouterConfig Interface

```typescript
interface ModelRouterConfig {
    // Default model used when no purpose-specific model is configured
    defaultModel: string;

    // Purpose-specific model overrides
    models?: Partial<Record<ModelPurpose, string>>;

    // Allowlist of valid model names (warns when model not in list)
    allowedModels?: string[];
}
```

### ModelPurpose Type

```typescript
type ModelPurpose =
    | 'agent_selection'
    | 'task_execution'
    | 'tool_synthesis'
    | 'final_response'
    | 'goal_achievement'
    | 'reflection'
    | 'summarization'
    | 'translation'
    | 'planning';
```

## See Also

- [Getting Started](./getting-started.md) - Basic setup and configuration
- [Conversation History](./conversation-history.md) - History summarization uses model routing
