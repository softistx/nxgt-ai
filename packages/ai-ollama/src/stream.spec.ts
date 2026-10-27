import { describe, expect, test } from 'bun:test';
import type { ModelEvent, ModelRequest } from '@nxgt/ai-core';
import { OllamaError } from './errors';
import { chunked, events, fixture, ndjson, run, setup } from './test-helpers';

const req: ModelRequest = {
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'Lyon?' }] }],
};

const expected: ModelEvent[] = [
	{ type: 'thinking-delta', text: 'Lyon, ' },
	{ type: 'thinking-delta', text: 'so the weather tool.' },
	{ type: 'text-delta', text: 'Je vérifie à Lyon. ' },
	{ type: 'tool-call', id: 'call_1', name: 'weather', input: { city: 'Lyon' } },
	{ type: 'tool-call', id: 'call_2', name: 'time', input: { zone: 'CET' } },
	{
		type: 'usage',
		usage: {
			inputTokens: 169,
			outputTokens: 18,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	},
	{ type: 'finish', reason: 'tool-use' },
];

describe('streaming', () => {
	test('posts to /api/chat with stream: true', async () => {
		const { model, calls } = setup([
			ndjson(chunked(fixture('stream-text'), 1000)),
		]);
		await events(model, req);
		expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
		expect(calls[0]?.body).toMatchObject({ model: 'llama-test', stream: true });
	});

	test('maps thinking, text, whole tool calls, usage and finish', async () => {
		const { model } = setup([
			ndjson(chunked(fixture('stream-thinking-tool'), 64)),
		]);
		expect(await events(model, req)).toEqual(expected);
	});

	test('gives the same events at any byte boundary', async () => {
		const bytes = new TextEncoder().encode(fixture('stream-thinking-tool'));
		for (let i = 1; i < bytes.length; i += 7) {
			const { model } = setup([ndjson([bytes.slice(0, i), bytes.slice(i)])]);
			expect(await events(model, req)).toEqual(expected);
		}
	});

	test('keeps multi-byte text intact over one-byte chunks; length is max-tokens', async () => {
		const { model } = setup([ndjson(chunked(fixture('stream-text'), 1))]);
		const out = await events(model, req);
		expect(out.filter((e) => e.type === 'text-delta')).toEqual([
			{ type: 'text-delta', text: 'Bon' },
			{ type: 'text-delta', text: 'jour 🌍' },
		]);
		expect(out.at(-1)).toEqual({ type: 'finish', reason: 'max-tokens' });
	});

	test('reads string arguments as JSON and defaults missing ones', async () => {
		const line = (calls: unknown) =>
			`${JSON.stringify({ message: { content: '', tool_calls: calls }, done: true, done_reason: 'stop' })}\n`;
		const { model } = setup([
			ndjson(
				chunked(
					line([
						{ function: { name: 'a', arguments: '{"x":1}' } },
						{ function: { name: 'b' } },
					]),
					1000,
				),
			),
		]);
		const calls = (await events(model, req)).filter(
			(e) => e.type === 'tool-call',
		);
		expect(calls.map((c) => c.input)).toEqual([{ x: 1 }, {}]);
	});

	test('an {"error"} line is an OllamaError', async () => {
		const { model } = setup([
			ndjson(chunked('{"error":"model runner crashed"}\n', 10)),
		]);
		const failure = events(model, req);
		expect(failure).rejects.toBeInstanceOf(OllamaError);
		expect(failure).rejects.toMatchObject({
			kind: 'provider',
			code: 'MODEL_ERROR',
		});
	});

	test('a stream that ends before done is an error', async () => {
		const { model } = setup([
			ndjson(
				chunked(
					'{"message":{"content":"par"},"done":false}\n{"message":{"content":"t"},"done":false}\n',
					10,
				),
			),
		]);
		expect(events(model, req)).rejects.toMatchObject({ kind: 'protocol' });
	});
});

describe('abort', () => {
	test('an already aborted signal makes no request', async () => {
		const { model, calls } = setup([ndjson([])]);
		const ctl = new AbortController();
		ctl.abort();
		expect(await events(model, req, ctl.signal)).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	test('aborting mid-stream ends the stream without an error', async () => {
		const ctl = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(
					new TextEncoder().encode(
						'{"message":{"content":"one"},"done":false}\n',
					),
				);
			},
		});
		const { model } = setup([new Response(body, { status: 200 })]);
		const seen: ModelEvent[] = [];
		for await (const e of run(model, req, ctl.signal)) {
			seen.push(e);
			ctl.abort();
		}
		expect(seen).toEqual([{ type: 'text-delta', text: 'one' }]);
	});

	test('a fetch that rejects because of the abort ends quietly', async () => {
		const ctl = new AbortController();
		const fetchAbort = (async (_u: unknown, init?: RequestInit) => {
			ctl.abort();
			throw init?.signal?.reason;
		}) as unknown as typeof fetch;
		const { model } = setup([], { fetch: fetchAbort });
		expect(await events(model, req, ctl.signal)).toEqual([]);
	});
});
