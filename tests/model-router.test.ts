import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ModelRouter } from '../src/ModelRouter';
import type { ModelPurpose } from '../src/utils/types';

describe('ModelRouter', () => {
    // Store original env values
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        // Save original env values
        originalEnv.DEFAULT_MODEL = process.env.DEFAULT_MODEL;
        originalEnv.MODEL_AGENT_SELECTION = process.env.MODEL_AGENT_SELECTION;
        originalEnv.MODEL_TASK_EXECUTION = process.env.MODEL_TASK_EXECUTION;
        originalEnv.MODEL_REFLECTION = process.env.MODEL_REFLECTION;

        // Clear env for clean tests
        delete process.env.DEFAULT_MODEL;
        delete process.env.MODEL_AGENT_SELECTION;
        delete process.env.MODEL_TASK_EXECUTION;
        delete process.env.MODEL_REFLECTION;
    });

    afterEach(() => {
        // Restore original env values
        if (originalEnv.DEFAULT_MODEL !== undefined) {
            process.env.DEFAULT_MODEL = originalEnv.DEFAULT_MODEL;
        } else {
            delete process.env.DEFAULT_MODEL;
        }
        if (originalEnv.MODEL_AGENT_SELECTION !== undefined) {
            process.env.MODEL_AGENT_SELECTION = originalEnv.MODEL_AGENT_SELECTION;
        } else {
            delete process.env.MODEL_AGENT_SELECTION;
        }
        if (originalEnv.MODEL_TASK_EXECUTION !== undefined) {
            process.env.MODEL_TASK_EXECUTION = originalEnv.MODEL_TASK_EXECUTION;
        } else {
            delete process.env.MODEL_TASK_EXECUTION;
        }
        if (originalEnv.MODEL_REFLECTION !== undefined) {
            process.env.MODEL_REFLECTION = originalEnv.MODEL_REFLECTION;
        } else {
            delete process.env.MODEL_REFLECTION;
        }
    });

    describe('constructor', () => {
        test('should use hardcoded default when no config provided', () => {
            const router = new ModelRouter();
            expect(router.getDefaultModel()).toBe('gpt-4o-mini');
        });

        test('should use provided default model', () => {
            const router = new ModelRouter({ defaultModel: 'gpt-4o' });
            expect(router.getDefaultModel()).toBe('gpt-4o');
        });

        test('should store purpose-specific models', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini',
                    reflection: 'gpt-3.5-turbo'
                }
            });

            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
            expect(router.getModel('reflection')).toBe('gpt-3.5-turbo');
            expect(router.getModel('task_execution')).toBe('gpt-4o'); // Falls back to default
        });
    });

    describe('fromEnv', () => {
        test('should use hardcoded default when DEFAULT_MODEL not set', () => {
            const router = ModelRouter.fromEnv();
            expect(router.getDefaultModel()).toBe('gpt-4o-mini');
        });

        test('should use DEFAULT_MODEL from environment', () => {
            process.env.DEFAULT_MODEL = 'gpt-4o';
            const router = ModelRouter.fromEnv();
            expect(router.getDefaultModel()).toBe('gpt-4o');
        });

        test('should load purpose-specific models from environment', () => {
            process.env.DEFAULT_MODEL = 'gpt-4o';
            process.env.MODEL_AGENT_SELECTION = 'gpt-4o-mini';
            process.env.MODEL_REFLECTION = 'gpt-3.5-turbo';

            const router = ModelRouter.fromEnv();

            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
            expect(router.getModel('reflection')).toBe('gpt-3.5-turbo');
            expect(router.getModel('task_execution')).toBe('gpt-4o');
        });
    });

    describe('getModel', () => {
        test('should return purpose-specific model when configured', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
        });

        test('should fall back to default when purpose not configured', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.getModel('task_execution')).toBe('gpt-4o');
            expect(router.getModel('reflection')).toBe('gpt-4o');
        });

        test('should work for all defined purposes', () => {
            const purposes: ModelPurpose[] = [
                'agent_selection',
                'task_execution',
                'tool_synthesis',
                'final_response',
                'goal_achievement',
                'reflection',
                'summarization',
                'translation',
                'planning'
            ];

            const router = new ModelRouter({
                defaultModel: 'gpt-4o-mini',
                warnOnUnknown: false
            });

            for (const purpose of purposes) {
                expect(router.getModel(purpose)).toBe('gpt-4o-mini');
            }
        });
    });

    describe('resolveModel', () => {
        test('should return override when provided', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.resolveModel('agent_selection', 'custom-model')).toBe('custom-model');
        });

        test('should return purpose model when no override', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.resolveModel('agent_selection')).toBe('gpt-4o-mini');
        });

        test('should return default when no override and no purpose model', () => {
            const router = new ModelRouter({ defaultModel: 'gpt-4o' });

            expect(router.resolveModel('task_execution')).toBe('gpt-4o');
        });
    });

    describe('hasModelFor', () => {
        test('should return true for configured purposes', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.hasModelFor('agent_selection')).toBe(true);
        });

        test('should return false for unconfigured purposes', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini'
                }
            });

            expect(router.hasModelFor('task_execution')).toBe(false);
        });
    });

    describe('getConfiguredModels', () => {
        test('should return all configured models including default', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini',
                    reflection: 'gpt-3.5-turbo'
                }
            });

            const configured = router.getConfiguredModels();

            expect(configured.default).toBe('gpt-4o');
            expect(configured.agent_selection).toBe('gpt-4o-mini');
            expect(configured.reflection).toBe('gpt-3.5-turbo');
            expect(configured.task_execution).toBeUndefined();
        });

        test('should return only default when no purpose models configured', () => {
            const router = new ModelRouter({ defaultModel: 'gpt-4o' });

            const configured = router.getConfiguredModels();

            expect(Object.keys(configured)).toEqual(['default']);
            expect(configured.default).toBe('gpt-4o');
        });
    });

    describe('validation', () => {
        test('should trim whitespace from model names', () => {
            const router = new ModelRouter({
                defaultModel: '  gpt-4o  ',
                models: {
                    agent_selection: '  gpt-4o-mini  '
                },
                warnOnUnknown: false
            });

            expect(router.getDefaultModel()).toBe('gpt-4o');
            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
        });

        test('should ignore empty model names', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: '',
                    reflection: '   '
                },
                warnOnUnknown: false
            });

            // Empty models should fall back to default
            expect(router.getModel('agent_selection')).toBe('gpt-4o');
            expect(router.getModel('reflection')).toBe('gpt-4o');
            expect(router.hasModelFor('agent_selection')).toBe(false);
        });

        test('should fall back to hardcoded default for empty defaultModel', () => {
            const router = new ModelRouter({
                defaultModel: '',
                warnOnUnknown: false
            });

            expect(router.getDefaultModel()).toBe('gpt-4o-mini');
        });

        test('should accept known model patterns without warning', () => {
            // These should not trigger warnings
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini',
                    task_execution: 'gpt-3.5-turbo',
                    reflection: 'claude-3-opus'
                }
            });

            expect(router.getDefaultModel()).toBe('gpt-4o');
            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
            expect(router.getModel('task_execution')).toBe('gpt-3.5-turbo');
            expect(router.getModel('reflection')).toBe('claude-3-opus');
        });

        test('should disable warnings with warnOnUnknown: false', () => {
            // Should not trigger warnings even for unknown patterns
            const router = new ModelRouter({
                defaultModel: 'my-custom-model',
                models: {
                    agent_selection: 'another-custom-model'
                },
                warnOnUnknown: false
            });

            expect(router.getDefaultModel()).toBe('my-custom-model');
            expect(router.getModel('agent_selection')).toBe('another-custom-model');
        });

        test('should validate against allowlist when provided', () => {
            const router = new ModelRouter({
                defaultModel: 'gpt-4o',
                models: {
                    agent_selection: 'gpt-4o-mini',
                    reflection: 'unknown-model'  // Not in allowlist
                },
                allowedModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']
            });

            // All models should still be set (validation is warnings only)
            expect(router.getDefaultModel()).toBe('gpt-4o');
            expect(router.getModel('agent_selection')).toBe('gpt-4o-mini');
            expect(router.getModel('reflection')).toBe('unknown-model');
        });
    });
});
