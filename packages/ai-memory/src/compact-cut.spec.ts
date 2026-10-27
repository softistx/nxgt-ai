import { describe, expect, it } from 'bun:test';
import type { Message } from '@nxgt/ai-core';
import { call, opts, result, say, stored } from './compact-fixtures';
import { compact, MemoryError, type StoredMessage } from './index';

describe('compact pairs and truncation', () => {
	it('keeps parallel calls with all their results', async () => {
		const parallel: Message = {
			role: 'assistant',
			parts: [
				{ type: 'tool-call', id: 'a', name: 'search', input: {} },
				{ type: 'tool-call', id: 'b', name: 'search', input: {} },
			],
		};
		const msgs = await stored([
			say(1),
			parallel,
			result('a', 'ok'),
			result('b', 'ok'),
			say(2),
		]);
		const out = await compact(msgs, opts(1, { keepLast: 2 }));
		expect(out.messages.map((m) => m.id)).toEqual(
			msgs.slice(1).map((m) => m.id),
		);
	});

	it('neither cuts an error result nor cuts an output twice', async () => {
		const error: Message = {
			role: 'tool',
			parts: [
				{
					type: 'tool-result',
					callId: 'e',
					name: 'search',
					isError: true,
					error: { code: 'TOOL_ERROR', message: 'x'.repeat(100) },
				} as Message['parts'][number],
			],
		};
		const msgs = await stored([
			call('e'),
			error,
			call('a'),
			result('a', 'y'.repeat(100)),
		]);
		const once = await compact(
			msgs,
			opts(1, { keepLast: 9, truncateToolResultsTo: 10 }),
		);
		expect(once.messages[1]).toEqual(msgs[1] as StoredMessage);
		const twice = await compact(
			once.messages,
			opts(1, { keepLast: 9, truncateToolResultsTo: 5 }),
		);
		expect(twice.messages).toEqual(once.messages);
	});
});

describe('compact cut placement and blank summaries', () => {
	it('moves the cut back from an assistant message to a user turn', async () => {
		const msgs = await stored([
			say(1),
			say(2),
			say(3, 'assistant'),
			say(4),
			say(5, 'assistant'),
		]);
		// naive cut: keepLast 2 starts at the assistant message m4? index 3 is user; use 3 kept
		const out = await compact(msgs, opts(1, { keepLast: 3 }));
		expect(out.messages[0]?.message.role).toBe('user');
		expect(out.messages.map((m) => m.id)).toEqual(
			msgs.slice(1).map((m) => m.id),
		);
	});

	it('moves the cut back from a tool message to a user turn', async () => {
		const msgs = await stored([
			say(1),
			say(2),
			call('a'),
			result('a', 'ok'),
			say(3, 'assistant'),
		]);
		const out = await compact(msgs, opts(1, { keepLast: 2 }));
		expect(out.messages[0]?.message.role).toBe('user');
		expect(out.messages.map((m) => m.id)).toEqual(
			msgs.slice(1).map((m) => m.id),
		);
		expect(out.throughMessageId).toBe(msgs[0]?.id as string);
	});

	it('keeps the pair-safe cut when no user turn precedes it', async () => {
		const msgs = await stored([
			say(1, 'assistant'),
			say(2, 'assistant'),
			say(3, 'assistant'),
		]);
		const out = await compact(msgs, opts(1, { keepLast: 1 }));
		expect(out.messages).toHaveLength(1);
		expect(out.summary).toBe('SUMMARY');
	});

	it('throws EMPTY_SUMMARY on a blank summary', async () => {
		const msgs = await stored([say(1), say(2)]);
		for (const blank of ['', '  \n']) {
			const err = await compact(msgs, {
				...opts(1, { keepLast: 1 }),
				summarize: async () => blank,
			}).catch((e: unknown) => e);
			expect(err).toBeInstanceOf(MemoryError);
			expect((err as MemoryError).code).toBe('EMPTY_SUMMARY');
		}
	});
});
