import { describe, expect, test } from 'bun:test';
import { type AgentEvent, AiError, generate } from '@nxgt/ai-core';
import {
	collect,
	expectToolCalls,
	fakeModel,
	textOf,
	toolCallsOf,
} from './index';

const req = {
	messages: [
		{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] },
	],
};
const drain = async (
	m: ReturnType<typeof fakeModel>,
	signal = new AbortController().signal,
) => collect(m.stream(req, signal));

describe('fakeModel', () => {
	const script = [
		{
			text: 'Hello world',
			chunk: 4,
			thinking: 'hmm',
			toolCalls: [{ name: 'w', input: { a: 1 } }],
		},
	];

	test('same script gives the same events, chunked deterministically', async () => {
		const a = await drain(fakeModel(script));
		const b = await drain(fakeModel(script));
		expect(a).toEqual(b);
		expect(
			a
				.filter((e) => e.type === 'text-delta')
				.map((e) => (e as { text: string }).text),
		).toEqual(['Hell', 'o wo', 'rld']);
		expect(a.at(-1)).toEqual({ type: 'finish', reason: 'tool-use' });
		expect(a).toContainEqual({
			type: 'tool-call',
			id: 'call_0_0',
			name: 'w',
			input: { a: 1 },
		});
	});

	test('works with generate', async () => {
		const r = await generate(
			fakeModel([
				{
					text: 'ok',
					usage: {
						inputTokens: 1,
						outputTokens: 2,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				},
			]),
			req,
		);
		expect(r.message.parts).toEqual([{ type: 'text', text: 'ok' }]);
		expect(r.usage.outputTokens).toBe(2);
	});

	test('records requests with their tools', async () => {
		const m = fakeModel([{ text: 'a' }, { text: 'b' }]);
		const tools = [
			{ name: 't', description: 'd', inputSchema: { type: 'object' as const } },
		];
		await drain({
			...m,
			stream: (r, s) => m.stream({ ...r, tools }, s),
		} as typeof m);
		await drain(m);
		expect(m.requests).toHaveLength(2);
		expect(m.requests[0]?.tools).toEqual(tools);
		expect(m.requests[1]?.tools).toBeUndefined();
	});

	test('function script receives the request and index', async () => {
		const m = fakeModel((r, i) => ({ text: `${i}:${r.messages.length}` }));
		expect(textOf((await drain(m)) as AgentEvent[])).toBe('0:1');
	});

	test('injects an error', async () => {
		const err = new AiError('RATE_LIMITED', 'slow down');
		await expect(drain(fakeModel([{ error: err }]))).rejects.toBe(err);
	});

	test('throws MODEL_ERROR past the end of the script', async () => {
		const m = fakeModel([]);
		await expect(drain(m)).rejects.toMatchObject({ code: 'MODEL_ERROR' });
	});

	test('abort during the delay ends the stream without events', async () => {
		const ac = new AbortController();
		const p = drain(fakeModel([{ text: 'late', delayMs: 10_000 }]), ac.signal);
		setTimeout(() => ac.abort(), 5);
		expect(await p).toEqual([]);
	});

	test('an already aborted signal yields nothing', async () => {
		const ac = new AbortController();
		ac.abort();
		expect(await drain(fakeModel([{ text: 'x' }]), ac.signal)).toEqual([]);
	});
});

describe('turn options', () => {
	test('chunks thinking, ignores chunk below 1, honours finish and usage', async () => {
		const usage = {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		};
		const a = await drain(
			fakeModel([
				{
					thinking: 'abcd',
					text: 'xyz',
					chunk: 2,
					usage,
					finish: 'max-tokens',
				},
			]),
		);
		expect(a).toEqual([
			{ type: 'thinking-delta', text: 'ab' },
			{ type: 'thinking-delta', text: 'cd' },
			{ type: 'text-delta', text: 'xyz' },
			{ type: 'usage', usage },
			{ type: 'finish', reason: 'max-tokens' },
		]);
		const b = await drain(fakeModel([{ text: 'xyz', chunk: 0 }]));
		expect(b[0]).toEqual({ type: 'text-delta', text: 'xyz' });
	});

	test('error after a delay', async () => {
		const err = new AiError('AUTHENTICATION', 'no');
		await expect(drain(fakeModel([{ error: err, delayMs: 1 }]))).rejects.toBe(
			err,
		);
	});
});

describe('collect and assertions', () => {
	const events: AgentEvent[] = [
		{ type: 'text-delta', text: 'a' },
		{ type: 'tool-call', id: '1', name: 'w', input: { city: 'Lyon' } },
		{ type: 'text-delta', text: 'b' },
	];
	async function* gen() {
		yield* events;
	}

	test('collects an async iterable and a run with events', async () => {
		expect(await collect(gen())).toEqual(events);
		expect(await collect({ events: gen() })).toEqual(events);
	});

	test('textOf and toolCallsOf', () => {
		expect(textOf(events)).toBe('ab');
		expect(toolCallsOf(events)).toEqual([
			{ name: 'w', input: { city: 'Lyon' } },
		]);
	});

	test('expectToolCalls passes and fails', () => {
		expectToolCalls(events, [{ name: 'w', input: { city: 'Lyon' } }]);
		expectToolCalls(events, [{ name: 'w' }]);
		expect(() =>
			expectToolCalls(events, [{ name: 'w', input: { city: 'Paris' } }]),
		).toThrow('Expected tool calls');
		expect(() => expectToolCalls(events, [])).toThrow();
		expect(() =>
			expectToolCalls(events, [{ name: 'w' }, { name: 'w' }]),
		).toThrow();
	});
});
