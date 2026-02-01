/**
 * Tests for Structured Output with Zod Schemas
 *
 * Verifies that responseSchema option produces valid, type-safe JSON responses.
 * Uses mock client for unit tests and real API for integration tests.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { Agent } from '../src/Agent';
import OpenAI from 'openai';
import { z } from 'zod';
import { createMockJsonClient } from './utils/mock-openai';

// Check if API key is available for integration tests
const hasApiKey = !!process.env.OPENAI_API_KEY;
const describeWithApi = hasApiKey ? describe : describe.skip;

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

/**
 * Simple schema for basic extraction
 */
const PersonSchema = z.object({
    name: z.string().describe('Person\'s full name'),
    age: z.number().describe('Person\'s age in years'),
    occupation: z.string().describe('Person\'s job or profession')
});

/**
 * Schema with enum fields
 */
const TaskSchema = z.object({
    title: z.string().describe('Task title'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).describe('Task priority level'),
    status: z.enum(['todo', 'in_progress', 'done']).describe('Current status'),
    estimatedHours: z.number().describe('Estimated hours to complete')
});

/**
 * Schema with nested objects
 */
const AddressSchema = z.object({
    street: z.string(),
    city: z.string(),
    country: z.string(),
    postalCode: z.string()
});

const CompanySchema = z.object({
    name: z.string().describe('Company name'),
    industry: z.string().describe('Industry sector'),
    employees: z.number().describe('Number of employees'),
    headquarters: AddressSchema.describe('Company headquarters address'),
    isPublic: z.boolean().describe('Whether company is publicly traded')
});

/**
 * Schema with arrays
 */
const MeetingNotesSchema = z.object({
    title: z.string().describe('Meeting title'),
    date: z.string().describe('Meeting date'),
    attendees: z.array(z.string()).describe('List of attendee names'),
    actionItems: z.array(z.object({
        task: z.string(),
        assignee: z.string(),
        dueDate: z.string()
    })).describe('Action items from the meeting'),
    summary: z.string().describe('Brief meeting summary')
});

/**
 * Schema with nullable fields
 */
const ProductSchema = z.object({
    name: z.string().describe('Product name'),
    price: z.number().describe('Price in USD'),
    category: z.string().describe('Product category'),
    description: z.string().nullable().describe('Product description, null if not available'),
    rating: z.number().nullable().describe('Average rating, null if no reviews'),
    inStock: z.boolean().describe('Whether product is in stock')
});

// ============================================================================
// UNIT TESTS (Mock Client)
// ============================================================================

describe('Structured Output - Schema Validation', () => {
    describe('PersonSchema', () => {
        it('validates correct person data', () => {
            const data = { name: 'John Doe', age: 30, occupation: 'Engineer' };
            const result = PersonSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('rejects invalid age type', () => {
            const data = { name: 'John Doe', age: 'thirty', occupation: 'Engineer' };
            const result = PersonSchema.safeParse(data);
            expect(result.success).toBe(false);
        });

        it('rejects missing required field', () => {
            const data = { name: 'John Doe', age: 30 };
            const result = PersonSchema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });

    describe('TaskSchema', () => {
        it('validates correct task data', () => {
            const data = {
                title: 'Fix bug',
                priority: 'high',
                status: 'in_progress',
                estimatedHours: 4
            };
            const result = TaskSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('rejects invalid enum value', () => {
            const data = {
                title: 'Fix bug',
                priority: 'urgent', // Not in enum
                status: 'in_progress',
                estimatedHours: 4
            };
            const result = TaskSchema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });

    describe('CompanySchema (nested)', () => {
        it('validates nested object structure', () => {
            const data = {
                name: 'TechCorp',
                industry: 'Technology',
                employees: 500,
                headquarters: {
                    street: '123 Main St',
                    city: 'San Francisco',
                    country: 'USA',
                    postalCode: '94105'
                },
                isPublic: true
            };
            const result = CompanySchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('rejects incomplete nested object', () => {
            const data = {
                name: 'TechCorp',
                industry: 'Technology',
                employees: 500,
                headquarters: {
                    street: '123 Main St',
                    city: 'San Francisco'
                    // Missing country and postalCode
                },
                isPublic: true
            };
            const result = CompanySchema.safeParse(data);
            expect(result.success).toBe(false);
        });
    });

    describe('MeetingNotesSchema (arrays)', () => {
        it('validates array fields', () => {
            const data = {
                title: 'Q4 Planning',
                date: '2024-01-15',
                attendees: ['Alice', 'Bob', 'Charlie'],
                actionItems: [
                    { task: 'Review budget', assignee: 'Alice', dueDate: '2024-01-20' },
                    { task: 'Draft proposal', assignee: 'Bob', dueDate: '2024-01-22' }
                ],
                summary: 'Discussed Q4 goals and assigned tasks.'
            };
            const result = MeetingNotesSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('accepts empty arrays', () => {
            const data = {
                title: 'Quick Sync',
                date: '2024-01-15',
                attendees: [],
                actionItems: [],
                summary: 'Brief status update, no action items.'
            };
            const result = MeetingNotesSchema.safeParse(data);
            expect(result.success).toBe(true);
        });
    });

    describe('ProductSchema (nullable)', () => {
        it('accepts null for nullable fields', () => {
            const data = {
                name: 'Widget',
                price: 29.99,
                category: 'Gadgets',
                description: null,
                rating: null,
                inStock: true
            };
            const result = ProductSchema.safeParse(data);
            expect(result.success).toBe(true);
        });

        it('accepts values for nullable fields', () => {
            const data = {
                name: 'Widget',
                price: 29.99,
                category: 'Gadgets',
                description: 'A useful widget',
                rating: 4.5,
                inStock: true
            };
            const result = ProductSchema.safeParse(data);
            expect(result.success).toBe(true);
        });
    });
});

describe('Structured Output - Mock Agent', () => {
    it('should parse JSON response from agent', async () => {
        const mockData = { name: 'Jane Smith', age: 28, occupation: 'Designer' };
        const { client } = createMockJsonClient([mockData]);

        const agent = new Agent({
            name: 'Extractor',
            goal: 'Extract person data',
            responseSchema: {
                schema: PersonSchema,
                name: 'person'
            }
        }, client);

        const result = await agent.performTask('Extract: Jane Smith is a 28-year-old designer.');
        const parsed = JSON.parse(result);

        expect(PersonSchema.safeParse(parsed).success).toBe(true);
        expect(parsed.name).toBe('Jane Smith');
        expect(parsed.age).toBe(28);
    });

    it('should handle nested schema response', async () => {
        const mockData = {
            name: 'StartupXYZ',
            industry: 'SaaS',
            employees: 50,
            headquarters: {
                street: '456 Tech Ave',
                city: 'Austin',
                country: 'USA',
                postalCode: '78701'
            },
            isPublic: false
        };
        const { client } = createMockJsonClient([mockData]);

        const agent = new Agent({
            name: 'CompanyExtractor',
            goal: 'Extract company data',
            responseSchema: {
                schema: CompanySchema,
                name: 'company'
            }
        }, client);

        const result = await agent.performTask('Extract company info...');
        const parsed = JSON.parse(result);

        expect(CompanySchema.safeParse(parsed).success).toBe(true);
        expect(parsed.headquarters.city).toBe('Austin');
    });

    it('should handle array response', async () => {
        const mockData = {
            title: 'Sprint Review',
            date: '2024-02-01',
            attendees: ['Dev1', 'Dev2', 'PM'],
            actionItems: [
                { task: 'Deploy v2.0', assignee: 'Dev1', dueDate: '2024-02-05' }
            ],
            summary: 'Sprint completed successfully.'
        };
        const { client } = createMockJsonClient([mockData]);

        const agent = new Agent({
            name: 'NotesExtractor',
            goal: 'Extract meeting notes',
            responseSchema: {
                schema: MeetingNotesSchema,
                name: 'meeting_notes'
            }
        }, client);

        const result = await agent.performTask('Extract meeting notes...');
        const parsed = JSON.parse(result);

        expect(MeetingNotesSchema.safeParse(parsed).success).toBe(true);
        expect(parsed.attendees).toHaveLength(3);
        expect(parsed.actionItems).toHaveLength(1);
    });
});

// ============================================================================
// INTEGRATION TESTS (Real API)
// ============================================================================

describeWithApi('Structured Output - API Integration', () => {
    let client: OpenAI;

    beforeAll(() => {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    });

    it('should extract person data with real API', async () => {
        const agent = new Agent({
            name: 'PersonExtractor',
            goal: 'Extract person information from text',
            model: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            responseSchema: {
                schema: PersonSchema,
                name: 'person_data'
            }
        }, client);

        const result = await agent.performTask(
            'John Smith is a 45-year-old software architect working at a major tech company.'
        );

        const parsed = JSON.parse(result);
        const validation = PersonSchema.safeParse(parsed);

        expect(validation.success).toBe(true);
        expect(parsed.name).toContain('John');
        expect(parsed.age).toBe(45);
        expect(typeof parsed.occupation).toBe('string');
    }, 15000);

    it('should extract task with enum fields', async () => {
        const agent = new Agent({
            name: 'TaskExtractor',
            goal: 'Extract task information',
            model: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            responseSchema: {
                schema: TaskSchema,
                name: 'task_data'
            }
        }, client);

        const result = await agent.performTask(
            'HIGH PRIORITY: Fix the login bug. Currently being worked on. Should take about 3 hours.'
        );

        const parsed = JSON.parse(result);
        const validation = TaskSchema.safeParse(parsed);

        expect(validation.success).toBe(true);
        expect(['low', 'medium', 'high', 'critical']).toContain(parsed.priority);
        expect(['todo', 'in_progress', 'done']).toContain(parsed.status);
        expect(typeof parsed.estimatedHours).toBe('number');
    }, 15000);

    it('should handle nullable fields correctly', async () => {
        const agent = new Agent({
            name: 'ProductExtractor',
            goal: 'Extract product information',
            model: process.env.DEFAULT_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            responseSchema: {
                schema: ProductSchema,
                name: 'product_data'
            }
        }, client);

        const result = await agent.performTask(
            'New product: SuperWidget priced at $49.99 in the Electronics category. Currently in stock. No reviews yet.'
        );

        const parsed = JSON.parse(result);
        const validation = ProductSchema.safeParse(parsed);

        expect(validation.success).toBe(true);
        expect(parsed.name).toBeDefined();
        expect(parsed.price).toBeGreaterThan(0);
        expect(parsed.inStock).toBe(true);
        // Rating should be null since no reviews
        expect(parsed.rating).toBeNull();
    }, 15000);
});
