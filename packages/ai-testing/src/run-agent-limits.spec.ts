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

	describe('abort and a tool that ignores its signal', () => {
		const deferred = () => {
			let release = () => {};
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			return { promise, release };
		};

		test('the run ends aborted without waiting for the tool', async () => {
			const gate = deferred();
			let finished = false;
			const stubborn = defineTool({
				name: 'stubborn',
				description: 'Ignores its signal until released',
				input: z.object({}),
				execute: async () => {
					await gate.promise;
					finished = true;
					return { done: true };
				},
			});
			const model = fakeModel([
				{ toolCalls: [call('stubborn', {})] },
				{ text: 'no' },
			]);
			const run = runAgent({ model, messages: user, tools: [stubborn] });
			setTimeout(() => run.abort(), 20);
			const events = await collect(run);
			const result = await run.result;
			expect(finished).toBe(false);
			expect(result.reason).toBe('aborted');
			expect(result.error?.code).toBe('ABORTED');
			expect(model.requests).toHaveLength(1);
			expect(result.messages[1]?.parts[0]).toMatchObject({
				isError: true,
				error: { code: 'ABORTED' },
			});
			expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'aborted' });
			gate.release();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(finished).toBe(true);
			expect(result.messages[1]?.parts[0]).toMatchObject({ isError: true });
		});

		test('a finished call keeps its result, the stuck one is ABORTED, observers see one result each', async () => {
			const gate = deferred();
			const stuck = defineTool({
				name: 'stuck',
				description: 'Never answers in time',
				input: z.object({}),
				execute: async () => {
					await gate.promise;
					return { late: true };
				},
			});
			const seen: { name: string; isError: boolean }[] = [];
			const model = fakeModel([
				{ toolCalls: [call('echo'), call('stuck', {})] },
				{ text: 'no' },
			]);
			const run = runAgent({
				model,
				messages: user,
				tools: [echo, stuck],
				observers: [
					{
						onToolCall: (i) =>
							void seen.push({ name: i.call.name, isError: i.result.isError }),
					},
				],
			});
			setTimeout(() => run.abort(), 50);
			const result = await run.result;
			gate.release();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(result.reason).toBe('aborted');
			const parts = result.messages[1]?.parts;
			expect(parts?.[0]).toMatchObject({ isError: false, output: { v: 'x' } });
			expect(parts?.[1]).toMatchObject({
				isError: true,
				error: { code: 'ABORTED' },
			});
			expect(seen).toEqual([
				{ name: 'echo', isError: false },
				{ name: 'stuck', isError: true },
			]);
		});

		test('an abort during onToolStart runs no tool and records no proposal', async () => {
			let executed = 0;
			let stored = 0;
			const normal = defineTool({
				name: 'normal',
				description: 'Has a side effect',
				input: z.object({}),
				execute: () => {
					executed += 1;
					return { ok: true };
				},
			});
			const gated = defineTool({
				name: 'gated',
				description: 'Needs a confirmation',
				input: z.object({}),
				confirm: true,
				execute: () => {
					executed += 1;
					return { ok: true };
				},
			});
			const model = fakeModel([
				{ toolCalls: [call('normal', {}), call('gated', {})] },
				{ text: 'no' },
			]);
			const controller = new AbortController();
			const run = runAgent({
				model,
				messages: user,
				tools: [normal, gated],
				signal: controller.signal,
				observers: [{ onToolStart: () => controller.abort() }],
			});
			const events = await collect(run);
			const result = await run.result;
			stored = events.filter((e) => e.type === 'proposed-action').length;
			expect(result.reason).toBe('aborted');
			expect(executed).toBe(0);
			expect(stored).toBe(0);
			expect(result.messages[1]?.parts).toHaveLength(2);
			for (const part of result.messages[1]?.parts ?? []) {
				expect(part).toMatchObject({
					isError: true,
					error: { code: 'ABORTED' },
				});
			}
		});
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
						message: `The call was cut off (the step ended ${finish}) and did not run.`,
					},
				},
			]);
			expect(types(events)).toContain('tool-result');
		},
	);
});
