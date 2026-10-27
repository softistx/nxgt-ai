import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { AiError, defineTool, jsonSchemaTool, toolSpec } from './index';

const props = (tool: { inputSchema: object }) =>
	tool.inputSchema as {
		properties: Record<string, unknown>;
		required?: string[];
	};

const make = (input: z.ZodType) =>
	defineTool({ name: 't', description: 'd', input, execute: () => 'ok' });

describe('the JSON Schema of a tool', () => {
	test('describes an object with required and optional fields and descriptions', () => {
		const tool = make(
			z.object({
				city: z.string().describe('The city to look up'),
				days: z.number().int().min(1).max(7).optional(),
			}),
		);
		expect(tool.inputSchema).toEqual({
			type: 'object',
			properties: {
				city: { type: 'string', description: 'The city to look up' },
				days: { type: 'integer', minimum: 1, maximum: 7 },
			},
			required: ['city'],
		});
	});

	test('describes enums and arrays', () => {
		const tool = make(
			z.object({
				unit: z.enum(['celsius', 'fahrenheit']),
				tags: z.array(z.string()),
			}),
		);
		const { properties } = props(tool);
		expect(properties['unit']).toEqual({
			type: 'string',
			enum: ['celsius', 'fahrenheit'],
		});
		expect(properties['tags']).toEqual({
			type: 'array',
			items: { type: 'string' },
		});
	});

	test('uses the input side: a default is optional for the model', () => {
		const tool = make(z.object({ limit: z.number().default(10) }));
		expect(props(tool).required).toBeUndefined();
	});

	test('carries no $schema key', () => {
		expect('$schema' in make(z.object({})).inputSchema).toBe(false);
	});

	test('toolSpec is what a model is told', () => {
		const tool = make(z.object({ q: z.string() }));
		expect(toolSpec(tool)).toEqual({
			name: 't',
			description: 'd',
			inputSchema: tool.inputSchema,
		});
	});

	test('refuses a schema that is not an object', () => {
		expect(() => make(z.string())).toThrow(AiError);
		try {
			make(z.string());
		} catch (error) {
			expect((error as AiError).code).toBe('INVALID_TOOL_DEFINITION');
		}
	});

	test('refuses a schema JSON Schema cannot express', () => {
		expect(() => make(z.object({ when: z.date() }))).toThrow();
	});

	test('jsonSchemaTool keeps the schema as given and refuses a non-object', () => {
		const schema = {
			type: 'object' as const,
			properties: { id: { type: 'string' } },
		};
		const tool = jsonSchemaTool({
			name: 'lookup',
			description: 'Look up',
			inputSchema: schema,
			execute: () => 1,
		});
		expect(tool.inputSchema).toEqual(schema);
		expect(() =>
			jsonSchemaTool({
				name: 'lookup',
				description: 'Look up',
				inputSchema: { type: 'string' },
				execute: () => 1,
			}),
		).toThrow(AiError);
	});
});
