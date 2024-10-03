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