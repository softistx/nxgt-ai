import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
	AiError,
	defineTool,
	executeTool,
	jsonSchemaTool,
	type ToolCallPart,
} from './index';

const call = (input: unknown, id = 'c1'): ToolCallPart => ({
	type: 'tool-call',
	id,
	name: 'weather',
	input,
});

const weather = defineTool({
	name: 'weather',
	description: 'Current weather',
	input: z.object({
		city: z.string().min(2),
		days: z.coerce.number().default(1),
	}),
	execute: ({ city, days }, { context }) => ({ city, days, by: context }),
});

describe('defineTool', () => {
	test('has confirm false by default and true when asked', () => {
		expect(weather.confirm).toBe(false);
		const mutation = defineTool({
			name: 'delete_note',
			description: 'Delete a note',
			input: z.object({ id: z.string() }),
			confirm: true,
			execute: () => null,
		});
		expect(mutation.confirm).toBe(true);
	});

	test.each(['', 'has space', 'a'.repeat(65), 'é'])(
		'refuses the name %p',
		(name) => {
			expect(() =>
				defineTool({
					name,
					description: 'd',
					input: z.object({}),
					execute: () => 1,
				}),
			).toThrow(AiError);
		},
	);

	test('refuses an empty description', () => {
		expect(() =>
			defineTool({
				name: 'a',
				description: ' ',
				input: z.object({}),
				execute: () => 1,
			}),
		).toThrow(/description/);
	});
});

describe('executeTool', () => {
	test('validates, runs with the parsed input and context, and returns the output', async () => {
		const result = await executeTool(
			weather,
			call({ city: 'Lyon', days: '3' }),
			{
				context: 'me',
			},
		);
		expect(result).toEqual({
			type: 'tool-result',
			callId: 'c1',
			name: 'weather',
			isError: false,
			output: { city: 'Lyon', days: 3, by: 'me' },
		});
	});

	test('invalid input yields an INVALID_TOOL_INPUT result without running execute', async () => {
		let ran = false;
		const tool = defineTool({
			name: 'weather',
			description: 'd',
			input: z.object({ city: z.string().min(2) }),
			execute: () => {
				ran = true;
			},
		});
		const result = await executeTool(tool, call({ city: 'L' }));
		expect(ran).toBe(false);
		expect(result).toMatchObject({
			isError: true,
			callId: 'c1',
			error: { code: 'INVALID_TOOL_INPUT', issues: [{ path: 'city' }] },
		});
		const missing = await executeTool(tool, call(undefined));
		expect(missing).toMatchObject({
			isError: true,
			error: { code: 'INVALID_TOOL_INPUT' },
		});
		if (missing.isError)
			expect(missing.error.message).toContain(
				'Invalid input for tool "weather"',
			);
	});

	test('a throwing execute yields TOOL_FAILED; an AiError keeps its code', async () => {
		const boom = defineTool({
			name: 'weather',
			description: 'd',
			input: z.object({}),
			execute: () => {
				throw new Error('db down');
			},
		});
		expect(await executeTool(boom, call({}))).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED', message: 'Tool "weather" failed: db down' },
		});
		const coded = jsonSchemaTool({
			name: 'weather',
			description: 'd',
			inputSchema: { type: 'object' },
			execute: async () => {
				throw new AiError('RATE_LIMITED', 'slow down');
			},
		});
		expect(await executeTool(coded, call({}))).toMatchObject({
			error: { code: 'RATE_LIMITED', message: 'slow down' },
		});
	});

	test('checks the output schema and returns the parsed value', async () => {
		const good = defineTool({
			name: 'weather',
			description: 'd',
			input: z.object({}),
			output: z.object({ n: z.coerce.number() }),
			execute: () => ({ n: '4' }),
		});
		expect(await executeTool(good, call({}))).toMatchObject({
			output: { n: 4 },
		});
		const bad = defineTool({
			name: 'weather',
			description: 'd',
			input: z.object({}),
			output: z.object({ n: z.number() }),
			// @ts-expect-error — the output schema refuses this on purpose
			execute: () => ({ n: 'x' }),
		});
		expect(await executeTool(bad, call({}))).toMatchObject({
			isError: true,
			error: { code: 'INVALID_TOOL_OUTPUT' },
		});
	});

	test('rejects with the abort reason when the run is aborted', async () => {
		const controller = new AbortController();
		const slow = defineTool({
			name: 'weather',
			description: 'd',
			input: z.object({}),
			execute: () => {
				controller.abort(new Error('stop'));
				throw new Error('cancelled');
			},
		});
		await expect(
			executeTool(slow, call({}), { signal: controller.signal }),
		).rejects.toThrow('stop');
	});
});

describe('jsonSchemaTool', () => {
	const tool = jsonSchemaTool<{ id: string }>({
		name: 'lookup',
		description: 'Look up',
		inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
		validate: (input) =>
			typeof (input as { id?: unknown })?.id === 'string'
				? { ok: true, value: input as { id: string } }
				: { ok: false, issues: [{ path: 'id', message: 'expected a string' }] },
		execute: ({ id }) => id.toUpperCase(),
	});

	test('uses the validate hook when given', async () => {
		expect(await executeTool(tool, call({ id: 'a' }))).toMatchObject({
			output: 'A',
		});
		expect(await executeTool(tool, call({ id: 1 }))).toMatchObject({
			error: {
				code: 'INVALID_TOOL_INPUT',
				issues: [{ path: 'id', message: 'expected a string' }],
			},
		});
	});

	test('passes the input through without a hook', async () => {
		const raw = jsonSchemaTool({
			name: 'echo',
			description: 'Echo',
			inputSchema: { type: 'object' },
			execute: (input) => input,
		});
		expect(await executeTool(raw, call({ any: 1 }))).toMatchObject({
			output: { any: 1 },
		});
	});
});
