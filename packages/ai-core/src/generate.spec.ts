import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';
import {
	type AgentEvent,
	AiError,
	agentEventSchema,
	generate,
	type ModelAdapter,
	type ModelEvent,
	type ModelRequest,
} from './index';

const req: ModelRequest = {
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
};
const usage = (n: number) => ({
	inputTokens: n,
	outputTokens: n,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

const adapter = (
	run: (signal: AbortSignal) => AsyncGenerator<ModelEvent>,
): ModelAdapter => ({
	provider: 'test',
	model: 't1',
	stream: (_r, signal) => run(signal),
});

describe('generate', () => {
	test('folds thinking, text, tool calls and usage', async () => {
		const model = adapter(async function* () {
			yield { type: 'thinking-delta', text: 'hm' };
			yield { type: 'thinking-delta', text: 'm', signature: 'sig' };
			yield { type: 'text-delta', text: 'Hel' };
			yield { type: 'text-delta', text: 'lo' };
			yield { type: 'tool-call', id: 'c1', name: 'weather', input: { a: 1 } };
			yield { type: 'usage', usage: usage(3) };
			yield { type: 'usage', usage: usage(2) };
			yield { type: 'finish', reason: 'tool-use' };
		});
		const out = await generate(model, req);
		expect(out.finishReason).toBe('tool-use');
		expect(out.usage).toEqual(usage(5));
		expect(out.message).toEqual({
			role: 'assistant',
			parts: [
				{ type: 'thinking', text: 'hmm', signature: 'sig' },
				{ type: 'text', text: 'Hello' },
				{ type: 'tool-call', id: 'c1', name: 'weather', input: { a: 1 } },
			],
		});
	});

	test('a stream without finish is a MODEL_ERROR', async () => {
		const model = adapter(async function* () {
			yield { type: 'text-delta', text: 'x' };
		});
		expect(generate(model, req)).rejects.toMatchObject({ code: 'MODEL_ERROR' });
	});

	test("an adapter's AiError passes through", async () => {
		const model = adapter(async function* () {
			yield { type: 'text-delta', text: 'x' };
			throw new AiError('RATE_LIMITED', 'slow down');
		});
		expect(generate(model, req)).rejects.toMatchObject({
			code: 'RATE_LIMITED',
		});
	});

	test('abort mid-stream ends with ABORTED', async () => {
		const controller = new AbortController();
		const model = adapter(async function* () {
			yield { type: 'text-delta', text: 'a' };
			controller.abort();
			yield { type: 'text-delta', text: 'b' };
			yield { type: 'finish', reason: 'end' };
		});
		expect(generate(model, req, controller.signal)).rejects.toMatchObject({
			code: 'ABORTED',
		});
	});

	test('an already aborted signal never calls the model', async () => {
		let called = false;
		const model = adapter(async function* () {
			called = true;
			yield { type: 'finish', reason: 'end' };
		});
		const signal = AbortSignal.abort();
		await expect(generate(model, req, signal)).rejects.toMatchObject({
			code: 'ABORTED',
		});
		expect(called).toBe(false);
	});

	test('an error thrown because of an abort becomes ABORTED', async () => {
		const controller = new AbortController();
		const model = adapter(async function* () {
			yield { type: 'text-delta', text: 'x' };
			controller.abort();
			throw new Error('fetch aborted');
		});
		await expect(generate(model, req, controller.signal)).rejects.toMatchObject(
			{ code: 'ABORTED' },
		);
	});
});

// Every AgentEvent must be accepted by the schema's inferred type.
const schemaCoversType: AgentEvent extends z.infer<typeof agentEventSchema>
	? true
	: false = true;

describe('agentEventSchema', () => {
	test('the schema and the AgentEvent type agree', () => {
		expect(schemaCoversType).toBe(true);
	});

	const events: AgentEvent[] = [
		{ type: 'step-start', step: 1 },
		{ type: 'text-delta', text: 'a' },
		{ type: 'thinking-delta', text: 'b', signature: 's' },
		{ type: 'tool-call', id: 'c1', name: 'w', input: { x: 1 } },
		{
			type: 'tool-result',
			result: {
				type: 'tool-result',
				callId: 'c1',
				name: 'w',
				isError: false,
				output: 18,
			},
		},
		{
			type: 'tool-result',
			result: {
				type: 'tool-result',
				callId: 'c1',
				name: 'w',
				isError: true,
				error: {
					code: 'INVALID_TOOL_INPUT',
					message: 'bad',
					issues: [{ path: 'city', message: 'required' }],
				},
			},
		},
		{
			type: 'proposed-action',
			action: { type: 'proposed-action', id: 'p1', tool: 'w', input: {} },
		},
		{
			type: 'message',
			message: { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
		},
		{ type: 'usage', usage: usage(1) },
		{ type: 'error', error: { code: 'MODEL_ERROR', message: 'x' } },
		{ type: 'done', reason: 'end', usage: usage(1) },
	];

	test('every event survives a JSON round-trip', () => {
		for (const event of events) {
			const back = agentEventSchema.parse(JSON.parse(JSON.stringify(event)));
			expect(back).toEqual(event);
		}
	});

	test('rejects an unknown type', () => {
		expect(agentEventSchema.safeParse({ type: 'nope' }).success).toBe(false);
	});
});
