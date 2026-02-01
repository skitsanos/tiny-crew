# Advanced Patterns

This guide covers advanced techniques for building sophisticated multi-agent systems with TinyCrew, including persona-based agents, behavioral modeling, and structured communication protocols.

## Persona-Based Agents

Create agents with rich, consistent personalities by defining structured profiles that guide their behavior.

### Profile Structure

```typescript
interface PersonaProfile {
    demographics: {
        name: string;
        age: number;
        background: string;
        expertise?: string[];
    };
    behavioral: BehavioralParameters;
    personality: PersonalityTraits;
    communication: {
        style: 'formal' | 'casual' | 'technical';
        verbosity: 'concise' | 'moderate' | 'detailed';
    };
}

interface BehavioralParameters {
    assertiveness: number;      // 0-1: passive to assertive
    riskTolerance: number;      // 0-1: risk-averse to risk-seeking
    detailOrientation: number;  // 0-1: big-picture to detail-focused
    collaborativeness: number;  // 0-1: independent to collaborative
}

interface PersonalityTraits {
    // Big Five (OCEAN) model
    openness: number;           // 0-1: traditional to curious
    conscientiousness: number;  // 0-1: flexible to organized
    extraversion: number;       // 0-1: reserved to outgoing
    agreeableness: number;      // 0-1: challenging to cooperative
    neuroticism: number;        // 0-1: stable to sensitive
}
```

### Creating Persona Agents

```typescript
function createPersonaAgent(profile: PersonaProfile, client: OpenAI): Agent {
    const systemPrompt = buildPersonaPrompt(profile);

    return new Agent({
        name: profile.demographics.name,
        goal: `Act as ${profile.demographics.name} with consistent personality`,
        systemPrompt,
        temperature: 0.7 + (profile.personality.openness * 0.2), // Higher openness = more creative
        capabilities: profile.demographics.expertise ?? []
    }, client);
}

function buildPersonaPrompt(profile: PersonaProfile): string {
    const { demographics, behavioral, personality } = profile;

    return `You are ${demographics.name}, age ${demographics.age}.
Background: ${demographics.background}

PERSONALITY TRAITS:
- Openness: ${describeLevel(personality.openness)} (${personality.openness > 0.6 ? 'curious, creative' : 'practical, conventional'})
- Conscientiousness: ${describeLevel(personality.conscientiousness)} (${personality.conscientiousness > 0.6 ? 'organized, thorough' : 'flexible, spontaneous'})
- Extraversion: ${describeLevel(personality.extraversion)} (${personality.extraversion > 0.6 ? 'outgoing, energetic' : 'reserved, reflective'})
- Agreeableness: ${describeLevel(personality.agreeableness)} (${personality.agreeableness > 0.6 ? 'cooperative, trusting' : 'challenging, skeptical'})
- Emotional Sensitivity: ${describeLevel(personality.neuroticism)} (${personality.neuroticism > 0.6 ? 'emotionally expressive' : 'calm, stable'})

BEHAVIORAL STYLE:
- Assertiveness: ${describeLevel(behavioral.assertiveness)}
- Risk Tolerance: ${describeLevel(behavioral.riskTolerance)}
- Detail Orientation: ${describeLevel(behavioral.detailOrientation)}
- Collaboration: ${describeLevel(behavioral.collaborativeness)}

Express these traits consistently in all interactions.`;
}

function describeLevel(value: number): string {
    if (value < 0.3) return 'Low';
    if (value < 0.7) return 'Moderate';
    return 'High';
}
```

### Behavioral Archetypes

Define reusable archetypes for common persona types:

```typescript
const ARCHETYPES = {
    analytical: {
        behavioral: {
            assertiveness: 0.5,
            riskTolerance: 0.3,
            detailOrientation: 0.9,
            collaborativeness: 0.6
        },
        personality: {
            openness: 0.7,
            conscientiousness: 0.9,
            extraversion: 0.3,
            agreeableness: 0.5,
            neuroticism: 0.3
        }
    },
    creative: {
        behavioral: {
            assertiveness: 0.6,
            riskTolerance: 0.8,
            detailOrientation: 0.4,
            collaborativeness: 0.7
        },
        personality: {
            openness: 0.95,
            conscientiousness: 0.4,
            extraversion: 0.7,
            agreeableness: 0.6,
            neuroticism: 0.5
        }
    },
    leader: {
        behavioral: {
            assertiveness: 0.85,
            riskTolerance: 0.6,
            detailOrientation: 0.5,
            collaborativeness: 0.7
        },
        personality: {
            openness: 0.6,
            conscientiousness: 0.8,
            extraversion: 0.8,
            agreeableness: 0.5,
            neuroticism: 0.2
        }
    }
};

// Usage
const analyst = createPersonaAgent({
    demographics: { name: 'Alex', age: 35, background: 'Data scientist' },
    ...ARCHETYPES.analytical,
    communication: { style: 'technical', verbosity: 'detailed' }
}, client);
```

## Structured Communication Protocols

For complex multi-agent workflows, use structured communication formats to ensure clarity and traceability.

### SBAR Protocol

SBAR (Situation, Background, Assessment, Recommendation) is particularly effective for handoffs and escalations:

```typescript
interface SBARMessage {
    from: string;
    to: string;
    timestamp: string;
    situation: string;      // What's happening now?
    background: string;     // Relevant context
    assessment: string;     // What do you think is going on?
    recommendation: string; // What should we do?
    priority: 'routine' | 'urgent' | 'critical';
}

class TeamCommunicator {
    private readonly messageLog: SBARMessage[] = [];

    createSBAR(
        from: string,
        to: string,
        sbar: Omit<SBARMessage, 'from' | 'to' | 'timestamp'>
    ): SBARMessage {
        const message: SBARMessage = {
            from,
            to,
            timestamp: new Date().toISOString(),
            ...sbar
        };

        this.messageLog.push(message);
        return message;
    }

    formatForAgent(message: SBARMessage): string {
        return `[${message.priority.toUpperCase()}] From: ${message.from}

SITUATION: ${message.situation}

BACKGROUND: ${message.background}

ASSESSMENT: ${message.assessment}

RECOMMENDATION: ${message.recommendation}`;
    }

    getMessagesFor(recipient: string): SBARMessage[] {
        return this.messageLog.filter(m =>
            m.to === recipient || m.to === 'all'
        );
    }
}
```

### Using SBAR in Agent Communication

```typescript
const communicator = new TeamCommunicator();

// Agent 1 sends structured message
const message = communicator.createSBAR('Analyst', 'Manager', {
    situation: 'Discovered anomaly in Q4 sales data',
    background: 'Running routine data validation, found 15% variance from projections',
    assessment: 'Likely data entry errors in November transactions',
    recommendation: 'Request audit of November entries before finalizing report',
    priority: 'urgent'
});

// Agent 2 receives and processes
const formattedMessage = communicator.formatForAgent(message);
const response = await managerAgent.chat(formattedMessage);
```

## Multi-Phase Orchestration

For complex workflows, orchestrate agents through defined phases:

```typescript
type WorkflowPhase =
    | 'discovery'
    | 'analysis'
    | 'discussion'
    | 'consensus'
    | 'planning'
    | 'execution';

interface PhaseEvent {
    phase: WorkflowPhase;
    agent: string;
    action: string;
    result: string;
    timestamp: string;
}

class WorkflowOrchestrator {
    private currentPhase: WorkflowPhase = 'discovery';
    private readonly events: PhaseEvent[] = [];
    private readonly phaseAgents: Map<WorkflowPhase, Agent[]> = new Map();

    registerAgent(phase: WorkflowPhase, agent: Agent): void {
        const agents = this.phaseAgents.get(phase) ?? [];
        agents.push(agent);
        this.phaseAgents.set(phase, agents);
    }

    async executePhase(phase: WorkflowPhase, context: string): Promise<string[]> {
        this.currentPhase = phase;
        const agents = this.phaseAgents.get(phase) ?? [];
        const results: string[] = [];

        for (const agent of agents) {
            const prompt = this.buildPhasePrompt(phase, context);
            const result = await agent.chat(prompt);

            this.events.push({
                phase,
                agent: agent.getName(),
                action: prompt.slice(0, 100),
                result: result.slice(0, 500),
                timestamp: new Date().toISOString()
            });

            results.push(result);
        }

        return results;
    }

    private buildPhasePrompt(phase: WorkflowPhase, context: string): string {
        const prompts: Record<WorkflowPhase, string> = {
            discovery: `Explore and identify key aspects of: ${context}`,
            analysis: `Analyze the findings: ${context}`,
            discussion: `Share your perspective on: ${context}`,
            consensus: `Identify areas of agreement and disagreement: ${context}`,
            planning: `Propose action items for: ${context}`,
            execution: `Execute the plan: ${context}`
        };
        return prompts[phase];
    }

    getSummary(): string {
        const byPhase = new Map<WorkflowPhase, PhaseEvent[]>();
        for (const event of this.events) {
            const events = byPhase.get(event.phase) ?? [];
            events.push(event);
            byPhase.set(event.phase, events);
        }

        let summary = '# Workflow Summary\n\n';
        for (const [phase, events] of byPhase) {
            summary += `## ${phase.toUpperCase()}\n`;
            for (const event of events) {
                summary += `- **${event.agent}**: ${event.result.slice(0, 200)}...\n`;
            }
            summary += '\n';
        }
        return summary;
    }
}
```

### Usage Example

```typescript
const orchestrator = new WorkflowOrchestrator();

// Register agents for each phase
orchestrator.registerAgent('discovery', researchAgent);
orchestrator.registerAgent('analysis', analystAgent);
orchestrator.registerAgent('discussion', analystAgent);
orchestrator.registerAgent('discussion', writerAgent);
orchestrator.registerAgent('consensus', leaderAgent);
orchestrator.registerAgent('planning', leaderAgent);

// Execute workflow
const topic = 'Market expansion strategy for Q2';

const discoveries = await orchestrator.executePhase('discovery', topic);
const analyses = await orchestrator.executePhase('analysis', discoveries.join('\n'));
const discussions = await orchestrator.executePhase('discussion', analyses.join('\n'));
const consensus = await orchestrator.executePhase('consensus', discussions.join('\n'));
const plan = await orchestrator.executePhase('planning', consensus.join('\n'));

console.log(orchestrator.getSummary());
```

## Programmatic Persona Generation

Generate realistic, validated personas programmatically for testing and simulation:

```typescript
interface PersonaTemplate {
    ageRange: [number, number];
    backgrounds: string[];
    expertiseAreas: string[][];
    archetypes: (keyof typeof ARCHETYPES)[];
}

class PersonaGenerator {
    private templates: Map<string, PersonaTemplate> = new Map();

    registerTemplate(name: string, template: PersonaTemplate): void {
        this.templates.set(name, template);
    }

    generate(templateName: string): PersonaProfile {
        const template = this.templates.get(templateName);
        if (!template) throw new Error(`Unknown template: ${templateName}`);

        const age = randomInt(template.ageRange[0], template.ageRange[1]);
        const background = pickRandom(template.backgrounds);
        const expertise = pickRandom(template.expertiseAreas);
        const archetype = ARCHETYPES[pickRandom(template.archetypes)];

        return {
            demographics: {
                name: this.generateName(),
                age,
                background,
                expertise
            },
            behavioral: this.varyParameters(archetype.behavioral),
            personality: this.varyParameters(archetype.personality),
            communication: {
                style: pickRandom(['formal', 'casual', 'technical']),
                verbosity: pickRandom(['concise', 'moderate', 'detailed'])
            }
        };
    }

    generateBatch(templateName: string, count: number): PersonaProfile[] {
        return Array.from({ length: count }, () => this.generate(templateName));
    }

    private varyParameters<T extends Record<string, number>>(params: T): T {
        const varied = { ...params };
        for (const key of Object.keys(varied)) {
            // Add ±10% variance
            varied[key as keyof T] = Math.max(0, Math.min(1,
                (varied[key as keyof T] as number) + (Math.random() - 0.5) * 0.2
            )) as T[keyof T];
        }
        return varied;
    }

    private generateName(): string {
        const firstNames = ['Alex', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Riley'];
        const lastNames = ['Smith', 'Johnson', 'Chen', 'Garcia', 'Kim', 'Patel'];
        return `${pickRandom(firstNames)} ${pickRandom(lastNames)}`;
    }
}

// Helper functions
function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}
```

### Validation

Validate generated personas for consistency:

```typescript
interface ValidationResult {
    valid: boolean;
    issues: string[];
}

function validatePersona(profile: PersonaProfile): ValidationResult {
    const issues: string[] = [];

    // Age validation
    if (profile.demographics.age < 18 || profile.demographics.age > 120) {
        issues.push(`Invalid age: ${profile.demographics.age}`);
    }

    // Parameter range validation
    for (const [key, value] of Object.entries(profile.behavioral)) {
        if (value < 0 || value > 1) {
            issues.push(`Behavioral.${key} out of range: ${value}`);
        }
    }

    for (const [key, value] of Object.entries(profile.personality)) {
        if (value < 0 || value > 1) {
            issues.push(`Personality.${key} out of range: ${value}`);
        }
    }

    // Consistency checks
    if (profile.personality.extraversion < 0.3 &&
        profile.communication.style === 'casual') {
        issues.push('Low extraversion inconsistent with casual communication style');
    }

    return {
        valid: issues.length === 0,
        issues
    };
}
```

## Best Practices

### 1. Personality Consistency

Ensure agents maintain consistent personality across interactions:

```typescript
// Include personality reminder in system prompt
const systemPrompt = `${basePersonaPrompt}

CONSISTENCY RULES:
- Always respond in character
- Reference your background when relevant
- Express opinions consistent with your personality traits
- Maintain your communication style throughout`;
```

### 2. Stress Testing

Test personas under challenging scenarios:

```typescript
async function stressTestPersona(agent: Agent, scenarios: string[]): Promise<void> {
    console.log(`Testing ${agent.getName()}...`);

    for (const scenario of scenarios) {
        const response = await agent.chat(scenario);
        console.log(`Scenario: ${scenario.slice(0, 50)}...`);
        console.log(`Response: ${response.slice(0, 200)}...`);
        console.log('---');
    }
}

// Test same scenario with different agents
const scenarios = [
    'You receive criticism about your work quality.',
    'A deadline is moved up by two weeks.',
    'A colleague takes credit for your idea.'
];

for (const agent of [analystAgent, creativeAgent, leaderAgent]) {
    await stressTestPersona(agent, scenarios);
}
```

### 3. Communication Logging

Track all inter-agent communication for debugging and analysis:

```typescript
class CommunicationLogger {
    private readonly logs: Array<{
        timestamp: string;
        from: string;
        to: string;
        message: string;
        response: string;
    }> = [];

    async loggedSend(
        from: Agent,
        to: Agent,
        message: string
    ): Promise<string> {
        const response = await to.chat(message);

        this.logs.push({
            timestamp: new Date().toISOString(),
            from: from.getName(),
            to: to.getName(),
            message,
            response
        });

        return response;
    }

    exportLogs(): string {
        return JSON.stringify(this.logs, null, 2);
    }
}
```

## See Also

- [Agent Messaging](./agent-messaging.md) - Built-in message bus
- [Use Cases](./use-cases.md) - Practical implementation scenarios
- [Custom Tools](./custom-tools.md) - Extending agent capabilities
