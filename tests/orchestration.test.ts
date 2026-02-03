/**
 * Tests for Multi-Agent Orchestration Patterns
 *
 * Verifies workflow orchestration, structured communication protocols (SBAR),
 * persona-based agents, and multi-phase coordination patterns.
 * Uses mock client for deterministic, fast unit tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Agent } from '../src/Agent';
import { MessageBus } from '../src/Agent/MessageBus';
import { createMockOpenAIClient } from './utils/mock-openai';

// ============================================================================
// SBAR COMMUNICATION PROTOCOL
// ============================================================================

/**
 * SBAR (Situation, Background, Assessment, Recommendation) message structure
 * Effective for handoffs and escalations in multi-agent systems
 */
interface SBARMessage {
    from: string;
    to: string;
    timestamp: string;
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
    priority: 'routine' | 'urgent' | 'critical';
}

/**
 * TeamCommunicator helper for SBAR messaging
 */
class TeamCommunicator {
    private readonly messageLog: SBARMessage[] = [];

    createSBAR(
        from: string,
        to: string,
        sbar: Omit<SBARMessage, 'from' | 'to' | 'timestamp'>,
    ): SBARMessage {
        const message: SBARMessage = {
            from,
            to,
            timestamp: new Date().toISOString(),
            ...sbar,
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
        return this.messageLog.filter(
            (m) => m.to === recipient || m.to === 'all',
        );
    }

    getAllMessages(): SBARMessage[] {
        return [...this.messageLog];
    }

    clear(): void {
        this.messageLog.length = 0;
    }
}

describe('SBAR Communication Protocol', () => {
    let communicator: TeamCommunicator;

    beforeEach(() => {
        communicator = new TeamCommunicator();
    });

    describe('message creation', () => {
        it('creates a valid SBAR message', () => {
            const message = communicator.createSBAR('Analyst', 'Manager', {
                situation: 'Discovered anomaly in Q4 sales data',
                background: 'Running routine data validation',
                assessment: 'Likely data entry errors in November',
                recommendation: 'Request audit of November entries',
                priority: 'urgent',
            });

            expect(message.from).toBe('Analyst');
            expect(message.to).toBe('Manager');
            expect(message.priority).toBe('urgent');
            expect(message.timestamp).toBeDefined();
        });

        it('logs messages for retrieval', () => {
            communicator.createSBAR('Agent1', 'Agent2', {
                situation: 'Test situation',
                background: 'Test background',
                assessment: 'Test assessment',
                recommendation: 'Test recommendation',
                priority: 'routine',
            });

            communicator.createSBAR('Agent1', 'Agent2', {
                situation: 'Second situation',
                background: 'Second background',
                assessment: 'Second assessment',
                recommendation: 'Second recommendation',
                priority: 'critical',
            });

            const messages = communicator.getMessagesFor('Agent2');
            expect(messages.length).toBe(2);
        });

        it('filters messages by recipient', () => {
            communicator.createSBAR('Agent1', 'Agent2', {
                situation: 'For Agent2',
                background: '',
                assessment: '',
                recommendation: '',
                priority: 'routine',
            });

            communicator.createSBAR('Agent1', 'Agent3', {
                situation: 'For Agent3',
                background: '',
                assessment: '',
                recommendation: '',
                priority: 'routine',
            });

            const agent2Messages = communicator.getMessagesFor('Agent2');
            const agent3Messages = communicator.getMessagesFor('Agent3');

            expect(agent2Messages.length).toBe(1);
            expect(agent3Messages.length).toBe(1);
            expect(agent2Messages[0].situation).toBe('For Agent2');
        });

        it('includes broadcast messages', () => {
            communicator.createSBAR('Leader', 'all', {
                situation: 'Team announcement',
                background: '',
                assessment: '',
                recommendation: '',
                priority: 'routine',
            });

            expect(communicator.getMessagesFor('Agent1').length).toBe(1);
            expect(communicator.getMessagesFor('Agent2').length).toBe(1);
        });
    });

    describe('message formatting', () => {
        it('formats SBAR message for agent consumption', () => {
            const message = communicator.createSBAR('Analyst', 'Manager', {
                situation: 'Sales anomaly detected',
                background: 'Q4 data validation in progress',
                assessment: 'Data entry errors likely',
                recommendation: 'Audit November entries',
                priority: 'urgent',
            });

            const formatted = communicator.formatForAgent(message);

            expect(formatted).toContain('[URGENT]');
            expect(formatted).toContain('From: Analyst');
            expect(formatted).toContain('SITUATION: Sales anomaly detected');
            expect(formatted).toContain('BACKGROUND: Q4 data validation');
            expect(formatted).toContain('ASSESSMENT: Data entry errors likely');
            expect(formatted).toContain(
                'RECOMMENDATION: Audit November entries',
            );
        });

        it('formats all priority levels correctly', () => {
            const routine = communicator.createSBAR('A', 'B', {
                situation: '',
                background: '',
                assessment: '',
                recommendation: '',
                priority: 'routine',
            });

            const critical = communicator.createSBAR('A', 'B', {
                situation: '',
                background: '',
                assessment: '',
                recommendation: '',
                priority: 'critical',
            });

            expect(communicator.formatForAgent(routine)).toContain('[ROUTINE]');
            expect(communicator.formatForAgent(critical)).toContain(
                '[CRITICAL]',
            );
        });
    });
});

// ============================================================================
// WORKFLOW ORCHESTRATION
// ============================================================================

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

/**
 * WorkflowOrchestrator for multi-phase agent coordination
 */
class WorkflowOrchestrator {
    private currentPhase: WorkflowPhase = 'discovery';
    private readonly events: PhaseEvent[] = [];
    private readonly phaseAgents: Map<WorkflowPhase, Agent[]> = new Map();

    registerAgent(phase: WorkflowPhase, agent: Agent): void {
        const agents = this.phaseAgents.get(phase) ?? [];
        agents.push(agent);
        this.phaseAgents.set(phase, agents);
    }

    getAgentsForPhase(phase: WorkflowPhase): Agent[] {
        return this.phaseAgents.get(phase) ?? [];
    }

    getCurrentPhase(): WorkflowPhase {
        return this.currentPhase;
    }

    async executePhase(
        phase: WorkflowPhase,
        context: string,
    ): Promise<string[]> {
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
                timestamp: new Date().toISOString(),
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
            execution: `Execute the plan: ${context}`,
        };
        return prompts[phase];
    }

    getEvents(): PhaseEvent[] {
        return [...this.events];
    }

    getEventsByPhase(phase: WorkflowPhase): PhaseEvent[] {
        return this.events.filter((e) => e.phase === phase);
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

    reset(): void {
        this.currentPhase = 'discovery';
        this.events.length = 0;
        this.phaseAgents.clear();
    }
}

describe('Workflow Orchestration', () => {
    let orchestrator: WorkflowOrchestrator;

    beforeEach(() => {
        orchestrator = new WorkflowOrchestrator();
    });

    afterEach(() => {
        orchestrator.reset();
    });

    describe('agent registration', () => {
        it('registers agents for phases', () => {
            const { client } = createMockOpenAIClient({ responses: ['OK'] });
            const agent = new Agent(
                { name: 'Researcher', goal: 'Research' },
                client,
            );

            orchestrator.registerAgent('discovery', agent);

            expect(orchestrator.getAgentsForPhase('discovery')).toContain(
                agent,
            );
        });

        it('allows multiple agents per phase', () => {
            const { client } = createMockOpenAIClient({ responses: ['OK'] });
            const agent1 = new Agent(
                { name: 'Analyst1', goal: 'Analyze' },
                client,
            );
            const agent2 = new Agent(
                { name: 'Analyst2', goal: 'Analyze' },
                client,
            );

            orchestrator.registerAgent('analysis', agent1);
            orchestrator.registerAgent('analysis', agent2);

            const agents = orchestrator.getAgentsForPhase('analysis');
            expect(agents.length).toBe(2);
        });

        it('registers same agent for multiple phases', () => {
            const { client } = createMockOpenAIClient({ responses: ['OK'] });
            const agent = new Agent(
                { name: 'Generalist', goal: 'Help' },
                client,
            );

            orchestrator.registerAgent('discovery', agent);
            orchestrator.registerAgent('planning', agent);

            expect(orchestrator.getAgentsForPhase('discovery')).toContain(
                agent,
            );
            expect(orchestrator.getAgentsForPhase('planning')).toContain(agent);
        });
    });

    describe('phase execution', () => {
        it('executes a single phase', async () => {
            const { client, stats } = createMockOpenAIClient({
                responses: ['Discovery findings: key trends identified'],
            });

            const researcher = new Agent(
                { name: 'Researcher', goal: 'Research' },
                client,
            );
            orchestrator.registerAgent('discovery', researcher);

            const results = await orchestrator.executePhase(
                'discovery',
                'AI trends',
            );

            expect(results.length).toBe(1);
            expect(results[0]).toContain('Discovery findings');
            expect(stats.totalCalls).toBe(1);
        });

        it('updates current phase', async () => {
            const { client } = createMockOpenAIClient({ responses: ['OK'] });
            const agent = new Agent({ name: 'Test', goal: 'Test' }, client);

            orchestrator.registerAgent('analysis', agent);

            expect(orchestrator.getCurrentPhase()).toBe('discovery');
            await orchestrator.executePhase('analysis', 'data');
            expect(orchestrator.getCurrentPhase()).toBe('analysis');
        });

        it('logs phase events', async () => {
            const { client } = createMockOpenAIClient({
                responses: ['Analysis complete'],
            });

            const analyst = new Agent(
                { name: 'Analyst', goal: 'Analyze' },
                client,
            );
            orchestrator.registerAgent('analysis', analyst);

            await orchestrator.executePhase('analysis', 'test data');

            const events = orchestrator.getEvents();
            expect(events.length).toBe(1);
            expect(events[0].phase).toBe('analysis');
            expect(events[0].agent).toBe('Analyst');
            expect(events[0].result).toContain('Analysis complete');
        });

        it('executes multiple agents in sequence', async () => {
            const { client, stats } = createMockOpenAIClient({
                responses: ['Agent1 perspective', 'Agent2 perspective'],
            });

            const agent1 = new Agent(
                { name: 'Agent1', goal: 'Discuss' },
                client,
            );
            const agent2 = new Agent(
                { name: 'Agent2', goal: 'Discuss' },
                client,
            );

            orchestrator.registerAgent('discussion', agent1);
            orchestrator.registerAgent('discussion', agent2);

            const results = await orchestrator.executePhase(
                'discussion',
                'topic',
            );

            expect(results.length).toBe(2);
            expect(stats.totalCalls).toBe(2);
        });
    });

    describe('multi-phase workflow', () => {
        it('executes complete workflow', async () => {
            const { client } = createMockOpenAIClient({
                responses: [
                    'Discovery: Found key insights',
                    'Analysis: Deep dive complete',
                    'Consensus: Team agrees',
                    'Plan: Action items defined',
                ],
            });

            const researcher = new Agent(
                { name: 'Researcher', goal: 'Research' },
                client,
            );
            const analyst = new Agent(
                { name: 'Analyst', goal: 'Analyze' },
                client,
            );
            const leader = new Agent({ name: 'Leader', goal: 'Lead' }, client);

            orchestrator.registerAgent('discovery', researcher);
            orchestrator.registerAgent('analysis', analyst);
            orchestrator.registerAgent('consensus', leader);
            orchestrator.registerAgent('planning', leader);

            const discoveries = await orchestrator.executePhase(
                'discovery',
                'market trends',
            );
            const analyses = await orchestrator.executePhase(
                'analysis',
                discoveries.join('\n'),
            );
            const consensus = await orchestrator.executePhase(
                'consensus',
                analyses.join('\n'),
            );
            const plan = await orchestrator.executePhase(
                'planning',
                consensus.join('\n'),
            );

            expect(orchestrator.getEvents().length).toBe(4);
            expect(plan[0]).toContain('Plan');
        });

        it('generates workflow summary', async () => {
            const { client } = createMockOpenAIClient({
                responses: ['Discovery result', 'Analysis result'],
            });

            const agent = new Agent({ name: 'Worker', goal: 'Work' }, client);
            orchestrator.registerAgent('discovery', agent);
            orchestrator.registerAgent('analysis', agent);

            await orchestrator.executePhase('discovery', 'topic');
            await orchestrator.executePhase('analysis', 'data');

            const summary = orchestrator.getSummary();

            expect(summary).toContain('# Workflow Summary');
            expect(summary).toContain('## DISCOVERY');
            expect(summary).toContain('## ANALYSIS');
            expect(summary).toContain('**Worker**');
        });

        it('filters events by phase', async () => {
            const { client } = createMockOpenAIClient({
                responses: ['D1', 'D2', 'A1'],
            });

            const agent1 = new Agent({ name: 'Agent1', goal: 'Work' }, client);
            const agent2 = new Agent({ name: 'Agent2', goal: 'Work' }, client);

            orchestrator.registerAgent('discovery', agent1);
            orchestrator.registerAgent('discovery', agent2);
            orchestrator.registerAgent('analysis', agent1);

            await orchestrator.executePhase('discovery', 'topic');
            await orchestrator.executePhase('analysis', 'data');

            expect(orchestrator.getEventsByPhase('discovery').length).toBe(2);
            expect(orchestrator.getEventsByPhase('analysis').length).toBe(1);
        });
    });
});

// ============================================================================
// PERSONA-BASED AGENTS
// ============================================================================

interface BehavioralParameters {
    assertiveness: number;
    riskTolerance: number;
    detailOrientation: number;
    collaborativeness: number;
}

interface PersonalityTraits {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
}

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

const ARCHETYPES = {
    analytical: {
        behavioral: {
            assertiveness: 0.5,
            riskTolerance: 0.3,
            detailOrientation: 0.9,
            collaborativeness: 0.6,
        },
        personality: {
            openness: 0.7,
            conscientiousness: 0.9,
            extraversion: 0.3,
            agreeableness: 0.5,
            neuroticism: 0.3,
        },
    },
    creative: {
        behavioral: {
            assertiveness: 0.6,
            riskTolerance: 0.8,
            detailOrientation: 0.4,
            collaborativeness: 0.7,
        },
        personality: {
            openness: 0.95,
            conscientiousness: 0.4,
            extraversion: 0.7,
            agreeableness: 0.6,
            neuroticism: 0.5,
        },
    },
    leader: {
        behavioral: {
            assertiveness: 0.85,
            riskTolerance: 0.6,
            detailOrientation: 0.5,
            collaborativeness: 0.7,
        },
        personality: {
            openness: 0.6,
            conscientiousness: 0.8,
            extraversion: 0.8,
            agreeableness: 0.5,
            neuroticism: 0.2,
        },
    },
};

function describeLevel(value: number): string {
    if (value < 0.3) return 'Low';
    if (value < 0.7) return 'Moderate';
    return 'High';
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

interface ValidationResult {
    valid: boolean;
    issues: string[];
}

function validatePersona(profile: PersonaProfile): ValidationResult {
    const issues: string[] = [];

    if (profile.demographics.age < 18 || profile.demographics.age > 120) {
        issues.push(`Invalid age: ${profile.demographics.age}`);
    }

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

    if (
        profile.personality.extraversion < 0.3 &&
        profile.communication.style === 'casual'
    ) {
        issues.push(
            'Low extraversion inconsistent with casual communication style',
        );
    }

    return {
        valid: issues.length === 0,
        issues,
    };
}

describe('Persona-Based Agents', () => {
    describe('archetype definitions', () => {
        it('analytical archetype has expected traits', () => {
            const analytical = ARCHETYPES.analytical;

            expect(analytical.behavioral.detailOrientation).toBeGreaterThan(
                0.8,
            );
            expect(analytical.behavioral.riskTolerance).toBeLessThan(0.5);
            expect(analytical.personality.conscientiousness).toBeGreaterThan(
                0.8,
            );
        });

        it('creative archetype has expected traits', () => {
            const creative = ARCHETYPES.creative;

            expect(creative.personality.openness).toBeGreaterThan(0.9);
            expect(creative.behavioral.riskTolerance).toBeGreaterThan(0.7);
            expect(creative.behavioral.detailOrientation).toBeLessThan(0.5);
        });

        it('leader archetype has expected traits', () => {
            const leader = ARCHETYPES.leader;

            expect(leader.behavioral.assertiveness).toBeGreaterThan(0.8);
            expect(leader.personality.extraversion).toBeGreaterThan(0.7);
            expect(leader.personality.neuroticism).toBeLessThan(0.3);
        });
    });

    describe('persona validation', () => {
        it('validates correct persona', () => {
            const profile: PersonaProfile = {
                demographics: {
                    name: 'Alex',
                    age: 35,
                    background: 'Data scientist',
                },
                ...ARCHETYPES.analytical,
                communication: { style: 'technical', verbosity: 'detailed' },
            };

            const result = validatePersona(profile);
            expect(result.valid).toBe(true);
            expect(result.issues.length).toBe(0);
        });

        it('rejects invalid age', () => {
            const profile: PersonaProfile = {
                demographics: { name: 'Child', age: 10, background: 'Student' },
                ...ARCHETYPES.analytical,
                communication: { style: 'casual', verbosity: 'concise' },
            };

            const result = validatePersona(profile);
            expect(result.valid).toBe(false);
            expect(result.issues.some((i) => i.includes('Invalid age'))).toBe(
                true,
            );
        });

        it('rejects out-of-range behavioral parameters', () => {
            const profile: PersonaProfile = {
                demographics: { name: 'Test', age: 30, background: 'Test' },
                behavioral: {
                    assertiveness: 1.5, // Out of range
                    riskTolerance: 0.5,
                    detailOrientation: 0.5,
                    collaborativeness: 0.5,
                },
                personality: ARCHETYPES.analytical.personality,
                communication: { style: 'formal', verbosity: 'moderate' },
            };

            const result = validatePersona(profile);
            expect(result.valid).toBe(false);
            expect(result.issues.some((i) => i.includes('assertiveness'))).toBe(
                true,
            );
        });

        it('warns on inconsistent traits', () => {
            const profile: PersonaProfile = {
                demographics: {
                    name: 'Introvert',
                    age: 30,
                    background: 'Researcher',
                },
                behavioral: ARCHETYPES.analytical.behavioral,
                personality: {
                    ...ARCHETYPES.analytical.personality,
                    extraversion: 0.2, // Very introverted
                },
                communication: { style: 'casual', verbosity: 'detailed' }, // Casual doesn't fit
            };

            const result = validatePersona(profile);
            expect(result.valid).toBe(false);
            expect(result.issues.some((i) => i.includes('inconsistent'))).toBe(
                true,
            );
        });
    });

    describe('persona prompt generation', () => {
        it('generates prompt with all sections', () => {
            const profile: PersonaProfile = {
                demographics: {
                    name: 'Jordan',
                    age: 42,
                    background: 'Software architect',
                },
                ...ARCHETYPES.leader,
                communication: { style: 'technical', verbosity: 'moderate' },
            };

            const prompt = buildPersonaPrompt(profile);

            expect(prompt).toContain('You are Jordan, age 42');
            expect(prompt).toContain('Software architect');
            expect(prompt).toContain('PERSONALITY TRAITS:');
            expect(prompt).toContain('BEHAVIORAL STYLE:');
        });

        it('correctly describes trait levels', () => {
            expect(describeLevel(0.1)).toBe('Low');
            expect(describeLevel(0.5)).toBe('Moderate');
            expect(describeLevel(0.9)).toBe('High');
        });

        it('adapts descriptions based on trait values', () => {
            const highOpenness: PersonaProfile = {
                demographics: {
                    name: 'Creative',
                    age: 30,
                    background: 'Artist',
                },
                ...ARCHETYPES.creative,
                communication: { style: 'casual', verbosity: 'detailed' },
            };

            const lowOpenness: PersonaProfile = {
                demographics: {
                    name: 'Traditional',
                    age: 50,
                    background: 'Accountant',
                },
                behavioral: ARCHETYPES.analytical.behavioral,
                personality: {
                    ...ARCHETYPES.analytical.personality,
                    openness: 0.2,
                },
                communication: { style: 'formal', verbosity: 'concise' },
            };

            const highPrompt = buildPersonaPrompt(highOpenness);
            const lowPrompt = buildPersonaPrompt(lowOpenness);

            expect(highPrompt).toContain('curious, creative');
            expect(lowPrompt).toContain('practical, conventional');
        });
    });

    describe('persona agent creation', () => {
        it('creates agent with persona system prompt', () => {
            const { client } = createMockOpenAIClient({
                responses: ['Hello!'],
            });

            const profile: PersonaProfile = {
                demographics: {
                    name: 'Alex',
                    age: 35,
                    background: 'Data scientist',
                    expertise: ['analytics', 'statistics'],
                },
                ...ARCHETYPES.analytical,
                communication: { style: 'technical', verbosity: 'detailed' },
            };

            const systemPrompt = buildPersonaPrompt(profile);
            const temperature = 0.7 + profile.personality.openness * 0.2;

            const agent = new Agent(
                {
                    name: profile.demographics.name,
                    goal: `Act as ${profile.demographics.name} with consistent personality`,
                    systemPrompt,
                    temperature,
                    capabilities: profile.demographics.expertise ?? [],
                },
                client,
            );

            expect(agent.getName()).toBe('Alex');
        });
    });
});

// ============================================================================
// MULTI-AGENT COORDINATION INTEGRATION
// ============================================================================

describe('Multi-Agent Coordination', () => {
    let bus: MessageBus;

    beforeEach(() => {
        bus = new MessageBus();
    });

    afterEach(() => {
        bus.reset();
    });

    it('coordinates task handoff between specialists', async () => {
        // Each agent gets its own mock client with sequential responses
        const { client: researchClient } = createMockOpenAIClient({
            responses: ['Research complete: Found 3 key insights on AI trends'],
        });
        const { client: analysisClient } = createMockOpenAIClient({
            responses: ['Analysis: Insights validated and prioritized'],
        });
        const { client: writerClient } = createMockOpenAIClient({
            responses: ['Report: Executive summary generated'],
        });

        const researcher = new Agent(
            { name: 'Researcher', goal: 'Research topics' },
            researchClient,
        );
        const analyst = new Agent(
            { name: 'Analyst', goal: 'Analyze data' },
            analysisClient,
        );
        const writer = new Agent(
            { name: 'Writer', goal: 'Create reports' },
            writerClient,
        );

        researcher.connectToMessageBus(bus);
        analyst.connectToMessageBus(bus);
        writer.connectToMessageBus(bus);

        // Research phase
        const researchResult = await researcher.chat('Research AI trends');
        expect(researchResult).toContain('insights');

        // Analysis phase (handoff)
        const analysisResult = await analyst.chat(`Analyze: ${researchResult}`);
        expect(analysisResult).toContain('Analysis');

        // Reporting phase (handoff)
        const report = await writer.chat(`Generate report: ${analysisResult}`);
        expect(report).toContain('Report');

        researcher.disconnectFromMessageBus();
        analyst.disconnectFromMessageBus();
        writer.disconnectFromMessageBus();
    });

    it('supports SBAR-formatted handoffs', async () => {
        const communicator = new TeamCommunicator();
        const { client, stats } = createMockOpenAIClient({
            responses: ['Acknowledged. Will investigate and report back.'],
        });

        const analyst = new Agent(
            { name: 'Analyst', goal: 'Analyze issues' },
            client,
        );
        const manager = new Agent(
            { name: 'Manager', goal: 'Manage team' },
            client,
        );

        analyst.connectToMessageBus(bus);
        manager.connectToMessageBus(bus);

        // Create SBAR message
        const sbarMessage = communicator.createSBAR('Analyst', 'Manager', {
            situation: 'Critical bug discovered in payment system',
            background: 'During routine monitoring, found transaction failures',
            assessment: 'Memory leak causing service degradation',
            recommendation: 'Immediate hotfix deployment required',
            priority: 'critical',
        });

        // Format and send to manager
        const formattedMessage = communicator.formatForAgent(sbarMessage);
        const response = await manager.chat(formattedMessage);

        expect(response).toContain('Acknowledged');
        expect(stats.totalCalls).toBe(1);

        analyst.disconnectFromMessageBus();
        manager.disconnectFromMessageBus();
    });

    it('orchestrates multi-phase workflow with different agents', async () => {
        const orchestrator = new WorkflowOrchestrator();
        const { client } = createMockOpenAIClient({
            responses: [
                'Discovery: Market opportunity identified in healthcare sector',
                'Analysis: 40% growth potential, moderate risk profile',
                'Consensus: Team recommends pursuing with phased approach',
                'Plan: Phase 1 - Market research, Phase 2 - MVP development',
            ],
        });

        const researcher = new Agent(
            { name: 'Researcher', goal: 'Find opportunities' },
            client,
        );
        const analyst = new Agent(
            { name: 'Analyst', goal: 'Analyze data' },
            client,
        );
        const leader = new Agent(
            { name: 'Leader', goal: 'Make decisions' },
            client,
        );

        orchestrator.registerAgent('discovery', researcher);
        orchestrator.registerAgent('analysis', analyst);
        orchestrator.registerAgent('consensus', leader);
        orchestrator.registerAgent('planning', leader);

        // Execute full workflow
        const discoveries = await orchestrator.executePhase(
            'discovery',
            'new market expansion',
        );
        const analyses = await orchestrator.executePhase(
            'analysis',
            discoveries.join('\n'),
        );
        const consensus = await orchestrator.executePhase(
            'consensus',
            analyses.join('\n'),
        );
        const plan = await orchestrator.executePhase(
            'planning',
            consensus.join('\n'),
        );

        // Verify workflow completed
        expect(orchestrator.getEvents().length).toBe(4);
        expect(plan[0]).toContain('Phase');

        // Verify summary generation
        const summary = orchestrator.getSummary();
        expect(summary).toContain('DISCOVERY');
        expect(summary).toContain('ANALYSIS');
        expect(summary).toContain('CONSENSUS');
        expect(summary).toContain('PLANNING');
    });
});
