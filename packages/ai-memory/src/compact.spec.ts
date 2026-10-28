import { describe, expect, it } from 'bun:test';
import { estimateTokens } from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';
import {
	call,
	chars,
	opts,
	result,
	say,
	stored,
} from '../test/compact-fixtures';
import {
	compact,
	inProcessMemory,
	type StoredMessage,
	summarizeWith,
} from './index';

describe('compact', () => {
	it('returns the messages untouched at the budget', async () => {
		const msgs = await stored([say(1), say(2)]);
		const size = chars(msgs.map((m) => m.message));
		const same = await compact(msgs, opts(size));
		expect(same.messages).toEqual(msgs);
		expect(same.summary).toBeUndefined();
		expect(same.tokens).toBe(size);
		const over = await compact(msgs, opts(size - 1, { keepLast: 1 }));
		expect(over.summary).toBe('SUMMARY');
		expect(over.throughMessageId).toBe(msgs[0]?.id as string);
		expect(over.messages).toEqual([msgs[1] as StoredMessage]);
	});

	it('cuts tool results oldest first and stops when it fits', async () => {
		const big = 'x'.repeat(500);
		const msgs = await stored([
			call('a'),
			result('a', big),
			call('b'),
			result('b', big),
		]);
		const full = chars(msgs.map((m) => m.message));
		const out = await compact(
			msgs,
			opts(full - 300, { truncateToolResultsTo: 20 }),
		);
		expect(out.summary).toBeUndefined();
		const outputs = out.messages
			.flatMap((m) => m.message.parts)
			.flatMap((p) =>
				p.type === 'tool-result' && !p.isError ? [p.output] : [],
			);
		expect(outputs[0]).toMatchObject({ truncated: true, originalChars: 502 });
		expect(outputs[1]).toBe(big);
		expect(msgs[1]?.message.parts[0]).toMatchObject({ output: big });
	});

	it('keeps a call with its result when the cut would split them', async () => {
		const msgs = await stored([
			say(1),
			call('a'),
			result('a', 'ok'),
			say(3),
			say(4),
		]);
		const out = await compact(msgs, opts(1, { keepLast: 3 }));
		expect(out.messages.map((m) => m.id)).toEqual(
			msgs.slice(1).map((m) => m.id),
		);
		expect(out.throughMessageId).toBe(msgs[0]?.id as string);
	});

	it('folds nothing when every message is kept', async () => {
		const msgs = await stored([say(1), say(2)]);
		const out = await compact(msgs, opts(1, { keepLast: 6 }));
		expect(out.summary).toBeUndefined();
		expect(out.messages).toHaveLength(2);
	});

	it('is idempotent on an already compacted thread', async () => {
		const msgs = await stored(Array.from({ length: 10 }, (_, i) => say(i)));
		const first = await compact(msgs, opts(80));
		expect(first.summary).toBe('SUMMARY');
		let calls = 0;
		const again = await compact(first.messages, {
			...opts(80, { summary: { text: 'SUMMARY' } }),
			summarize: async () => {
				calls++;
				return 'X';
			},
		});
		expect(calls).toBe(0);
		expect(again.summary).toBeUndefined();
		expect(again.messages).toEqual(first.messages);
		expect(again.tokens).toBe(first.tokens);
	});

	it('gives the previous summary to the next one', async () => {
		const msgs = await stored(Array.from({ length: 8 }, (_, i) => say(i)));
		const model = fakeModel([{ text: 'NEW SUMMARY' }]);
		const out = await compact(msgs, {
			budget: 1,
			estimate: chars,
			keepLast: 2,
			summary: { text: 'OLD SUMMARY' },
			summarize: summarizeWith(model),
		});
		expect(out.summary).toBe('NEW SUMMARY');
		expect(out.messages).toHaveLength(2);
		const sent = JSON.stringify(model.requests[0]?.messages);
		expect(sent).toContain('OLD SUMMARY');
		expect(sent).toContain('m0');
		expect(sent).not.toContain('m7');
	});

	it('uses estimateTokens by default', async () => {
		const msgs = await stored([say(1)]);
		const out = await compact(msgs, {
			budget: 100,
			summarize: async () => 'S',
		});
		expect(out.tokens).toBe(estimateTokens([say(1)]));
	});

	it('stores through setSummary and loads the tail', async () => {
		const store = inProcessMemory();
		const t = await store.createThread({ ownerId: 'o' });
		const all = await store.append(
			t.id,
			'o',
			Array.from({ length: 8 }, (_, i) => say(i)),
		);
		const out = await compact(all, opts(1, { keepLast: 3 }));
		await store.setSummary(t.id, 'o', {
			text: out.summary as string,
			throughMessageId: out.throughMessageId as string,
			tokens: 1,
		});
		const loaded = await store.load(t.id, 'o', { sinceSummary: true });
		expect(loaded?.summary?.text).toBe('SUMMARY');
		expect(loaded?.messages.map((m) => m.id)).toEqual(
			out.messages.map((m) => m.id),
		);
	});
});
