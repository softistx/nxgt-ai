import { describe, expect, test } from 'bun:test';
import { type AgentEvent, defineTool, runAgent } from '@nxgt/ai-core';
import { z } from 'zod';
import { collect, fakeModel, type Turn } from './index';

const usage = (n: number) => ({
	inputTokens: n,
	outputTokens: n,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});
const user = [
	{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'go' }] },
];
const echo = defineTool({
	name: 'echo',
	description: 'Echoes its input',
	input: z.object({ v: z.string() }),
	execute: ({ v }) => ({ v }),
});
const call = (name: string, input: unknown = { v: 'x' }) => ({ name, input });
const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('runAgent limits and abort', () => {
	test('maxSteps ends with MAX_STEPS', async () => {
		const model = fakeModel(() => ({ toolCalls: [call('echo')] }));
		const run = runAgent({ model, messages: user, tools: [echo], maxSteps: 2 });
		const events = await collect(run);
		const result = await run.result;
		expect(result).toMatchObject({ reason: 'max-steps', steps: 2 });
		expect(result.error?.code).toBe('MAX_STEPS');
		expect(model.requests).toHaveLength(2);
		expect(types(events).slice(-2)).toEqual(['error', 'done']);
	});

	test('budget ends with BUDGET_EXCEEDED', async () => {
		const model = fakeModel(() => ({
			toolCalls: [call('echo')],
			usage: usage(10),
		}));
		const run = runAgent({
			model,
			messages: user,
			tools: [echo],
			budget: { maxTotalTokens: 30 },
		});
		const events = await collect(run);
		const result = await run.result;
		expect(result).toMatchObject({ reason: 'budget', steps: 2 });
		expect(result.error?.code).toBe('BUDGET_EXCEEDED');
		expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'budget' });
	});

	test('input and output budgets are checked on their own', async () => {
		const turn = (): Turn => ({
			toolCalls: [call('echo')],
			usage: { ...usage(1), outputTokens: 50 },
		});
		const out = runAgent({
			model: fakeModel(turn),
			messages: user,
			tools: [echo],
			budget: { maxOutputTokens: 50 },
		});
		expect((await out.result).reason).toBe('budget');
		const input = runAgent({
			model: fakeModel(turn),
			messages: user,
			tools: [echo],
			budget: { maxInputTokens: 2 },
		});
		expect((await input.result).steps).toBe(2);
	});

	test('abort during the text stream', async () => {
		const model = fakeModel([{ text: 'late', delayMs: 5000 }]);
		const run = runAgent({ model, messages: user });
		setTimeout(() => run.abort(), 10);
		const events = await collect(run);
		const result = await run.result;
		expect(result).toMatchObject({ reason: 'aborted', messages: [] });
		expect(result.error?.code).toBe('ABORTED');
		expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' });
	});

	test('abort during a tool reaches ToolContext.signal', async () => {
		let seen: AbortSignal | undefined;
		const hang = defineTool({
			name: 'hang',
			description: 'Waits for the abort',
			input: z.object({}),
			execute: (_i, { signal }) => {
				seen = signal;
				return new Promise((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason)),
				);
			},
		});
		const model = fakeModel([
			{ toolCalls: [call('hang', {})] },
			{ text: 'no' },
		]);
		const controller = new AbortController();
		const run = runAgent({
			model,
			messages: user,
			tools: [hang],
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 10);
		const result = await run.result;
		expect(seen?.aborted).toBe(true);
		expect(result.reason).toBe('aborted');
		expect(model.requests).toHaveLength(1);
		const part = result.messages[1]?.parts[0];
		expect(part).toMatchObject({ isError: true, error: { code: 'ABORTED' } });
	});

	test('an already aborted signal makes no model call', async () => {
		const model = fakeModel([{ text: 'x' }]);
		const run = runAgent({
			model,
			messages: user,
			signal: AbortSignal.abort(),
		});
		expect((await run.result).reason).toBe('aborted');
		expect(model.requests).toHaveLength(0);
	});

	test('a provider error ends the run with its code', async () => {
		const { AiError } = await import('@nxgt/ai-core');
		const model = fakeModel([{ error: new AiError('RATE_LIMITED', 'slow') }]);
		const run = runAgent({ model, messages: user });
		const events = await collect(run);
		expect((await run.result).error).toEqual({
			code: 'RATE_LIMITED',
			message: 'slow',
		});
		expect(types(events).slice(-2)).toEqual(['error', 'done']);
	});

	test.each(['max-tokens', 'end', 'refusal'] as const)(
		'tool calls on a step that finished %s are answered with error results',
		async (finish) => {
			const model = fakeModel([{ toolCalls: [call('echo')], finish }]);
			const run = runAgent({ model, messages: user, tools: [echo] });
			const events = await collect(run);
			const result = await run.result;
			expect(result.reason).toBe(finish);
			expect(result.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
			expect(result.messages[1]?.parts).toEqual([
				{
					type: 'tool-result',
					callId: 'call_0_0',
					name: 'echo',
					isError: true,
					error: {
						code: 'MODEL_ERROR',
						message: `The call was cut off (${finish}) and did not run.`,
					},
				},
			]);
			expect(types(events)).toContain('tool-result');
		},
	);
});
