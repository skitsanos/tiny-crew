export interface TaskResult
{
    agent: string;
    task: string;
    result: string;
}

export interface TaskError
{
    agent: string;
    task: string;
    error: Error;
}

export interface AgentConfig
{
    name: string;
    model?: string;
    goal: string;
    expectedOutput?: string;
}

export interface ToolParameter {
    type: string;
    description: string;
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
}