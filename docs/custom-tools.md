# Creating Custom Tools

Tools allow agents to interact with external services, perform computations, and take actions in the real world. This guide covers creating custom tools and extending TinyCrew's capabilities.

## Tool Interface

All tools implement the `Tool` interface:

```typescript
interface Tool {
    name: string;
    description: string;
    schema: ToolSchema;

    validateInput(args: any): boolean;
    use(args: any): Promise<any>;
    getCapabilities(): string[];
}
```

## Basic Tool Example

```typescript
import { Tool, ToolSchema } from 'tiny-crew/utils/types';
import Logger from 'tiny-crew/utils/logger';

export class WeatherTool implements Tool {
    public readonly name = 'WeatherTool';
    public readonly description = 'Get current weather for a location';
    private readonly logger: Logger;
    private readonly apiKey: string;

    constructor(apiKey: string) {
        this.logger = new Logger('WeatherTool');
        this.apiKey = apiKey;
    }

    public readonly schema: ToolSchema = {
        name: this.name,
        description: this.description,
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'City name or coordinates'
                },
                units: {
                    type: 'string',
                    description: 'Temperature units',
                    enum: ['celsius', 'fahrenheit'],
                    default: 'celsius'
                }
            },
            required: ['location', 'units']  // All parameters must be required
        }
    };

    public validateInput(args: any): boolean {
        if (!args.location || typeof args.location !== 'string') {
            return false;
        }
        if (!['celsius', 'fahrenheit'].includes(args.units)) {
            return false;
        }
        return true;
    }

    public async use(args: { location: string; units: string }): Promise<any> {
        this.logger.info(`Getting weather for ${args.location}`);

        // Call weather API
        const response = await fetch(
            `https://api.weather.com/v1/current?location=${args.location}&units=${args.units}`,
            { headers: { 'Authorization': `Bearer ${this.apiKey}` } }
        );

        const data = await response.json();
        return {
            location: args.location,
            temperature: data.temperature,
            conditions: data.conditions,
            units: args.units
        };
    }

    public getCapabilities(): string[] {
        return ['weather', 'forecast', 'climate'];
    }
}
```

## Tool Schema Requirements

OpenAI's strict mode requires all parameters to be marked as required:

```typescript
// Correct: All parameters required with defaults
parameters: {
    type: 'object',
    properties: {
        url: { type: 'string', description: 'URL to process' },
        format: { type: 'string', description: 'Output format', default: 'json' }
    },
    required: ['url', 'format']  // All parameters must be required
}

// Incorrect: Optional parameters not supported in strict mode
parameters: {
    type: 'object',
    properties: {
        url: { type: 'string', description: 'URL to process' },
        format: { type: 'string', description: 'Output format' }
    },
    required: ['url']  // Missing 'format' - will fail in strict mode
}
```

## Registering Tools with Agents

```typescript
import { Agent } from 'tiny-crew';
import { WeatherTool } from './tools/WeatherTool';
import { FileWriteTool } from 'tiny-crew/Tools/FileWriteTool';

const weatherTool = new WeatherTool(process.env.WEATHER_API_KEY);
const fileWriteTool = new FileWriteTool({ basePath: './data' });

const agent = new Agent({
    name: 'WeatherReporter',
    goal: 'Report weather conditions and save reports',
    capabilities: ['weather', 'file_management']
}, openai, [weatherTool, fileWriteTool]);
```

## Built-in Tools

TinyCrew includes several built-in tools:

### FileWriteTool

Securely write files to disk:

```typescript
import { FileWriteTool } from 'tiny-crew/Tools/FileWriteTool';

const fileWriter = new FileWriteTool({
    basePath: './data',
    allowedExtensions: ['.txt', '.md', '.json', '.py'],
    maxFileSize: 1024 * 1024  // 1MB
});
```

### WebScrapeTool

Scrape web pages with security controls:

```typescript
import { WebScrapeTool } from 'tiny-crew/Tools/WebScrapeTool';

const scraper = new WebScrapeTool({
    allowedDomains: ['example.com', 'api.example.com'],
    blockedDomains: ['malicious.com'],
    timeout: 30000
});
```

### TextPromptTool

Create custom LLM-powered tools:

```typescript
import { TextPromptTool } from 'tiny-crew/Tools/TextPromptTool';

const translator = new TextPromptTool({
    name: 'Translator',
    description: 'Translate text between languages',
    model: 'gpt-4o-mini',
    promptTemplate: 'Translate the following text from {source_lang} to {target_lang}:\n\n{text}',
    parameters: {
        text: { type: 'string', description: 'Text to translate' },
        source_lang: { type: 'string', description: 'Source language' },
        target_lang: { type: 'string', description: 'Target language' }
    }
}, openai);
```

## Tool Security Best Practices

### 1. Input Validation

Always validate inputs before processing:

```typescript
public validateInput(args: any): boolean {
    // Check required fields
    if (!args.filename || typeof args.filename !== 'string') {
        return false;
    }

    // Sanitize paths to prevent directory traversal
    if (args.filename.includes('..') || args.filename.startsWith('/')) {
        this.logger.warn('Path traversal attempt blocked');
        return false;
    }

    // Validate allowed extensions
    const ext = path.extname(args.filename);
    if (!this.allowedExtensions.includes(ext)) {
        return false;
    }

    return true;
}
```

### 2. Path Sanitization

Prevent directory traversal attacks:

```typescript
import path from 'path';

private sanitizePath(filename: string): string {
    // Resolve to absolute path within base directory
    const resolved = path.resolve(this.basePath, filename);

    // Ensure path is within base directory
    if (!resolved.startsWith(path.resolve(this.basePath))) {
        throw new Error('Path escapes base directory');
    }

    return resolved;
}
```

### 3. Rate Limiting

Protect external API calls:

```typescript
import { RateLimiter } from 'tiny-crew/utils/rateLimiter';

const limiter = new RateLimiter({
    requestsPerMinute: 60,
    tokensPerMinute: 100000
});

public async use(args: any): Promise<any> {
    return limiter.execute(async () => {
        // API call here
    });
}
```

## Creating a Plugin System

For more complex extensions, create plugins:

```typescript
interface TinyCrewPlugin {
    name: string;
    description: string;

    initialize(context: PluginContext): Promise<void>;

    hooks?: {
        onTaskStart?: (task: Task) => void;
        onTaskComplete?: (result: TaskResult) => void;
        onMemoryUpdate?: (update: MemoryUpdate) => void;
        onError?: (error: Error) => void;
    };
}

// Example: Analytics Plugin
const analyticsPlugin: TinyCrewPlugin = {
    name: 'AnalyticsPlugin',
    description: 'Tracks and analyzes agent performance',

    async initialize(context) {
        // Set up analytics connection
        this.analytics = new AnalyticsClient(context.config);
    },

    hooks: {
        onTaskComplete: (result) => {
            this.analytics.track('task_completed', {
                agent: result.agent,
                duration: result.duration,
                success: true
            });
        },

        onError: (error) => {
            this.analytics.track('error', {
                message: error.message,
                stack: error.stack
            });
        }
    }
};

// Register plugin with crew
crew.registerPlugin(analyticsPlugin);
```

## Testing Tools

Write comprehensive tests for your tools:

```typescript
import { describe, test, expect } from 'bun:test';
import { WeatherTool } from './WeatherTool';

describe('WeatherTool', () => {
    const tool = new WeatherTool('test-api-key');

    test('validates input correctly', () => {
        expect(tool.validateInput({ location: 'London', units: 'celsius' })).toBe(true);
        expect(tool.validateInput({ location: '', units: 'celsius' })).toBe(false);
        expect(tool.validateInput({ location: 'London', units: 'invalid' })).toBe(false);
    });

    test('returns capabilities', () => {
        const caps = tool.getCapabilities();
        expect(caps).toContain('weather');
    });

    test('schema is valid', () => {
        expect(tool.schema.name).toBe('WeatherTool');
        expect(tool.schema.parameters.required).toContain('location');
        expect(tool.schema.parameters.required).toContain('units');
    });
});
```

## See Also

- [Memory Tools](./memory-tools.md) - Built-in tools for agent memory management
- [Getting Started](./getting-started.md) - Basic setup and usage
