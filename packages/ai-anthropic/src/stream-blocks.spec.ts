import { describe, expect, test } from 'bun:test';
import {
	type AgentResult,
	defineTool,
	generate,
	type ModelRequest,
	runAgent,
} from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';
import { z } from 'zod';
import { toWireMessages } from './request';
import { chunked, events, setup, sse } from './test-helpers';

const req: ModelRequest = {
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
};

type Wire = Record<string, unknown>;
const body = (list: Wire[]) =>
	list
		.map((e) => `event: ${e['type']}\ndata: ${JSON.stringify(e)}\n\n`)
		.join('');
const start = (index: number, content_block: Wire): Wire => ({
	type: 'content_block_start',
	index,
	content_block,
});
const delta = (index: number, d: Wire): Wire => ({
	type: 'content_block_delta',
	index,
	delta: d,
});
const stop = (index: number): Wire => ({ type: 'content_block_stop', index });
const end = (stop_reason: string): Wire[] => [
	{
		type: 'message_delta',
		delta: { stop_reason },
		usage: { output_tokens: 3 },
	},
	{ type: 'message_stop' },
];
const stream = (list: Wire[]) => sse(chunked(body(list), 11));

const thinking = (i: number, text: string, signature: string): Wire[] => [
	start(i, { type: 'thinking', thinking: '' }),
	delta(i, { type: 'thinking_delta', thinking: text }),
	delta(i, { type: 'signature_delta', signature }),
	stop(i),
];

const cutTool = (): Wire[] => [
	start(0, { type: 'tool_use', id: 'toolu_1', name: 'echo', input: {} }),
	delta(0, { type: 'input_json_delta', partial_json: '{"v": "ab' }),
	stop(0),
];

describe('a tool input cut by max_tokens', () => {
	test('is dropped and the call finishes max-tokens', async () => {
		const { model } = setup([stream([...cutTool(), ...end('max_tokens')])]);
		const out = await events(model, req);
		expect(out.some((e) => e.type === 'tool-call')).toBe(false);
		expect(out.at(-1)).toEqual({ type: 'finish', reason: 'max-tokens' });
	});

	test('a block that never got its stop event is dropped too', async () => {
		const list = [...cutTool().slice(0, 2), ...end('max_tokens')];
		const out = await events(setup([stream(list)]).model, req);
		expect(out.at(-1)).toEqual({ type: 'finish', reason: 'max-tokens' });
	});

	test('a complete tool call before the cut one is kept', async () => {
		const whole = [
			start(0, { type: 'tool_use', id: 'toolu_0', name: 'echo', input: {} }),
			delta(0, { type: 'input_json_delta', partial_json: '{"v":"a"}' }),
			stop(0),
		];
		const list = [...whole, ...cutTool().map(shift), ...end('max_tokens')];
		const out = await events(setup([stream(list)]).model, req);
		expect(out.filter((e) => e.type === 'tool-call')).toHaveLength(1);
	});

	test('the same bad input without max_tokens is still a MODEL_ERROR', async () => {
		const { model } = setup([stream([...cutTool(), ...end('tool_use')])]);
		expect(events(model, req)).rejects.toMatchObject({ code: 'MODEL_ERROR' });
	});
});

const shift = (e: Wire): Wire => ({ ...e, index: 1 });

describe('consecutive blocks', () => {
	test('two thinking blocks keep their own signatures', async () => {
		const list = [...thinking(0, 'one', 's1'), ...thinking(1, 'two', 's2')];
		const { model } = setup([stream([...list, ...end('end_turn')])]);
		const out = await generate(model, req);
		expect(out.message.parts).toEqual([
			{ type: 'thinking', text: 'one', signature: 's1' },
			{ type: 'thinking', text: 'two', signature: 's2' },
		]);
	});

	test('two text blocks stay two parts', async () => {
		const text = (i: number, t: string): Wire[] => [
			start(i, { type: 'text', text: '' }),
			delta(i, { type: 'text_delta', text: t }),
			stop(i),
		];
		const list = [...text(0, 'a'), ...text(1, 'b'), ...end('end_turn')];
		const out = await generate(setup([stream(list)]).model, req);
		expect(out.message.parts).toEqual([
			{ type: 'text', text: 'a' },
			{ type: 'text', text: 'b' },
		]);
	});
});

describe('a cut step and the next turn', () => {
	const echo = defineTool({
		name: 'echo',
		description: 'Echoes',
		input: z.object({ v: z.string() }),
		execute: ({ v }) => ({ v }),
	});

	/** Every tool_use must be followed by its tool_result, in the next message. */
	function expectAnswered(result: AgentResult) {
		const wire = toWireMessages([...req.messages, ...result.messages]);
		wire.forEach((message, i) => {
			const uses = message.content.filter((b) => b['type'] === 'tool_use');
			if (uses.length === 0) return;
			const next = wire[i + 1];
			const answered = (next?.content ?? [])
				.filter((b) => b['type'] === 'tool_result')
				.map((b) => (b as { tool_use_id: string }).tool_use_id);
			for (const use of uses) {
				expect(answered).toContain((use as { id: string }).id);
			}
		});
	}

	test.each(['max-tokens', 'end', 'refusal'] as const)(
		'a step that finished %s leaves no tool_use unanswered on the wire',
		async (finish) => {
			const model = fakeModel([
				{ toolCalls: [{ name: 'echo', input: { v: 'x' } }], finish },
			]);
			const run = runAgent({ model, messages: req.messages, tools: [echo] });
			const result = await run.result;
			expect(result.reason).toBe(finish);
			expect(result.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
			expectAnswered(result);
		},
	);
});
