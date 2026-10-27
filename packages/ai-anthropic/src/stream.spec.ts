import { describe, expect, test } from 'bun:test';
import { generate, type ModelEvent, type ModelRequest } from '@nxgt/ai-core';
import { AnthropicError } from './errors';
import { chunked, events, json, setup, sse, sseFixture } from './test-helpers';

const req: ModelRequest = {
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'Lyon?' }] }],
};

const merged = (list: ModelEvent[]) => {
	// Compare after joining adjacent text deltas: the cut points move them.
	const out: ModelEvent[] = [];
	for (const e of list) {
		const last = out.at(-1);
		if (e.type === 'text-delta' && last?.type === 'text-delta')
			last.text += e.text;
		else out.push({ ...e });
	}
	return out;
};

const expected: ModelEvent[] = [
	{ type: 'thinking-delta', text: 'Lyon, so ', start: true },
	{ type: 'thinking-delta', text: 'the weather tool.' },
	{ type: 'thinking-delta', text: '', signature: 'EqQBCgIYAhIM' },
	{ type: 'text-delta', text: 'Je vérifie à Lyon.', start: true },
	{
		type: 'tool-call',
		id: 'toolu_01',
		name: 'weather',
		input: { city: 'Lyon' },
	},
	{
		type: 'usage',
		usage: {
			// 25 plain + 40 cache read + 100 cache write
			inputTokens: 165,
			outputTokens: 57,
			cacheReadTokens: 40,
			cacheWriteTokens: 100,
		},
	},
	{ type: 'finish', reason: 'tool-use' },
];

describe('streaming', () => {
	test('sends stream: true and maps thinking, text, tool call, usage and finish', async () => {
		const { model, calls } = setup([
			sse(chunked(sseFixture('stream-thinking-tool'), 64)),
		]);
		expect(merged(await events(model, req))).toEqual(expected);
		expect(calls[0]?.body).toMatchObject({ stream: true });
	});

	test('gives the same events at any byte boundary', async () => {
		const bytes = new TextEncoder().encode(sseFixture('stream-thinking-tool'));
		for (let i = 1; i < bytes.length; i += 7) {
			const { model } = setup([sse([bytes.slice(0, i), bytes.slice(i)])]);
			expect(merged(await events(model, req))).toEqual(expected);
		}
	});

	test('gives the same events one byte at a time', async () => {
		const { model } = setup([
			sse(chunked(sseFixture('stream-thinking-tool'), 1)),
		]);
		expect(merged(await events(model, req))).toEqual(expected);
	});

	test('an error event throws a classified AnthropicError after the text', async () => {
		const { model } = setup([sse(chunked(sseFixture('stream-error'), 50))]);
		const seen: ModelEvent[] = [];
		let error: unknown;
		try {
			for await (const e of model.stream(req, new AbortController().signal))
				seen.push(e);
		} catch (e) {
			error = e;
		}
		expect(seen).toEqual([{ type: 'text-delta', text: 'Par', start: true }]);
		expect(error).toBeInstanceOf(AnthropicError);
		expect((error as AnthropicError).kind).toBe('overloaded');
	});

	test('a stream cut before message_stop is a retryable network error, not retried', async () => {
		const cut = sseFixture('stream-error').split('event: error')[0] ?? '';
		const { model, calls } = setup([sse(chunked(cut, 40))]);
		const error = await events(model, req).catch((e) => e);
		expect((error as AnthropicError).kind).toBe('network');
		expect(calls).toHaveLength(1);
	});

	test('maps stop reasons: pause_turn and refusal', async () => {
		for (const [stop, reason] of [
			['pause_turn', 'end'],
			['refusal', 'refusal'],
			['max_tokens', 'max-tokens'],
		] as const) {
			const body = `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 2 } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`;
			const { model } = setup([sse(chunked(body, 9))]);
			expect((await events(model, req)).at(-1)).toEqual({
				type: 'finish',
				reason,
			});
		}
	});

	test('retries apply before the first byte only', async () => {
		const { model, calls, sleeps } = setup([
			new Response('{"error":{"message":"busy"}}', { status: 529 }),
			sse(chunked(sseFixture('stream-thinking-tool'), 80)),
		]);
		expect((await events(model, req)).at(-1)).toEqual({
			type: 'finish',
			reason: 'tool-use',
		});
		expect(calls).toHaveLength(2);
		expect(sleeps).toHaveLength(1);
	});

	test('an abort during the stream ends it quietly', async () => {
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new TextEncoder().encode('event: ping\ndata: {}\n\n'));
				// A real fetch body errors when its signal aborts.
				controller.signal.addEventListener('abort', () =>
					c.error(new Error('aborted')),
				);
			},
			pull() {
				controller.abort();
			},
		});
		const { model } = setup([
			new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
		]);
		expect(await events(model, req, controller.signal)).toEqual([]);
	});

	test('keeps a redacted_thinking block and sends it back unchanged', async () => {
		const { model, calls } = setup([
			sse(chunked(sseFixture('stream-redacted-tool'), 33)),
			sse(chunked(sseFixture('stream-thinking-tool'), 64)),
		]);
		const first = await generate(model, req, new AbortController().signal);
		expect(first.message.parts).toEqual([
			{ type: 'thinking', text: '', redacted: 'EmwKAhgBEgy3va3pzix/LafPsn4=' },
			{
				type: 'tool-call',
				id: 'toolu_02',
				name: 'weather',
				input: { city: 'Lyon' },
			},
		]);
		await generate(
			model,
			{
				messages: [
					...req.messages,
					first.message,
					{
						role: 'tool',
						parts: [
							{
								type: 'tool-result',
								callId: 'toolu_02',
								name: 'weather',
								isError: false,
								output: 'sunny',
							},
						],
					},
				],
			},
			new AbortController().signal,
		);
		const sent = calls[1]?.body['messages'] as Array<{ content: unknown[] }>;
		expect(sent[1]?.content).toEqual([
			{ type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix/LafPsn4=' },
			{
				type: 'tool_use',
				id: 'toolu_02',
				name: 'weather',
				input: { city: 'Lyon' },
			},
		]);
	});

	test('a redacted block is not merged with the thinking around it', async () => {
		const { model } = setup([
			sse(chunked(sseFixture('stream-redacted-tool'), 1)),
		]);
		expect((await events(model, req))[0]).toEqual({
			type: 'thinking-delta',
			text: '',
			redacted: 'EmwKAhgBEgy3va3pzix/LafPsn4=',
		});
	});

	test('a non-streamed response keeps thinking and redacted_thinking blocks', async () => {
		const body = JSON.stringify({
			content: [
				{ type: 'thinking', thinking: 'hm', signature: 'sig' },
				{ type: 'redacted_thinking', data: 'opaque' },
				{ type: 'text', text: 'ok' },
			],
			stop_reason: 'end_turn',
		});
		const { model } = setup([json(body)]);
		const got = await generate(model, req, new AbortController().signal);
		expect(got.message.parts).toEqual([
			{ type: 'thinking', text: 'hm', signature: 'sig' },
			{ type: 'thinking', text: '', redacted: 'opaque' },
			{ type: 'text', text: 'ok' },
		]);
	});
});
