import { describe, expect, it } from 'bun:test';
import type { Message } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import type { MemoryStore, Page } from './types';

const text = (t: string, role: Message['role'] = 'user'): Message => ({
	role,
	parts: [{ type: 'text', text: t }],
});

const page = (cursor?: string): Page => ({
	limit: 2,
	...(cursor === undefined ? {} : { cursor }),
});

const proposal = (id: string): Message => ({
	role: 'assistant',
	parts: [
		{
			type: 'proposed-action',
			id,
			tool: 'archive',
			input: {},
			expiresAt: 9e15,
		},
	],
});

/**
 * The behaviour every `MemoryStore` must have. Call it inside a test file with
 * a factory that returns a fresh, empty store each time:
 *
 *     memoryStoreContract(() => myStore());
 */
export function memoryStoreContract(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
	describe('MemoryStore contract', () => {
		it('creates, gets and deletes a thread', async () => {
			const store = await make();
			const t = await store.createThread({
				ownerId: 'a',
				title: 'Hi',
				meta: { k: 1 },
			});
			expect(await store.getThread(t.id, 'a')).toMatchObject({
				id: t.id,
				ownerId: 'a',
				title: 'Hi',
				meta: { k: 1 },
				messageCount: 0,
			});
			expect(await store.deleteThread(t.id, 'a')).toBe(true);
			expect(await store.getThread(t.id, 'a')).toBeUndefined();
			expect(await store.deleteThread(t.id, 'a')).toBe(false);
		});

		it("hides another owner's thread on every call", async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			const [m] = await store.append(t.id, 'a', [proposal('act-1')]);
			expect(await store.getThread(t.id, 'b')).toBeUndefined();
			expect((await store.listThreads('b')).items).toEqual([]);
			expect(
				await store.load(t.id, 'b', { sinceSummary: false }),
			).toBeUndefined();
			expect(await store.findAction('act-1', 'b')).toBeUndefined();
			expect(
				await store.updateAction('act-1', 'b', { status: 'confirmed' }),
			).toBeUndefined();
			expect(await store.deleteThread(t.id, 'b')).toBe(false);
			const denied = [
				store.append(t.id, 'b', [text('x')]),
				store.setSummary(t.id, 'b', {
					text: 's',
					throughMessageId: m?.id ?? '',
					tokens: 1,
				}),
			];
			for (const call of denied) {
				await expect(call).rejects.toMatchObject({ code: 'THREAD_NOT_FOUND' });
			}
			expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
			expect(
				(await store.load(t.id, 'a', { sinceSummary: false }))?.messages,
			).toHaveLength(1);
		});

		it('appends messages in order and loads them', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			await store.append(t.id, 'a', [text('one'), text('two', 'assistant')]);
			await store.append(t.id, 'a', [text('three')]);
			const loaded = await store.load(t.id, 'a', { sinceSummary: false });
			expect(loaded?.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
			expect(loaded?.messages.map((m) => m.message.parts[0])).toEqual([
				{ type: 'text', text: 'one' },
				{ type: 'text', text: 'two' },
				{ type: 'text', text: 'three' },
			]);
			expect(loaded?.thread.messageCount).toBe(3);
		});

		it('rejects a message that is not valid', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			const bad = { role: 'nobody', parts: [] } as unknown as Message;
			await expect(store.append(t.id, 'a', [bad])).rejects.toThrow();
			expect((await store.getThread(t.id, 'a'))?.messageCount).toBe(0);
		});

		it('pages threads newest first with a cursor', async () => {
			const store = await make();
			const ids: string[] = [];
			for (let i = 0; i < 5; i++)
				ids.push((await store.createThread({ ownerId: 'a' })).id);
			await store.createThread({ ownerId: 'b' });
			const id = (n: number) => ids[n] as string;
			const first = await store.listThreads('a', { limit: 2 });
			expect(first.items.map((t) => t.id)).toEqual([id(4), id(3)]);
			expect(first.nextCursor).toBeDefined();
			const second = await store.listThreads('a', page(first.nextCursor));
			expect(second.items.map((t) => t.id)).toEqual([id(2), id(1)]);
			const third = await store.listThreads('a', page(second.nextCursor));
			expect(third.items.map((t) => t.id)).toEqual([id(0)]);
			expect(third.nextCursor).toBeUndefined();
		});

		it('rejects a cursor it did not give', async () => {
			const store = await make();
			await expect(
				store.listThreads('a', { cursor: 'nope' }),
			).rejects.toBeInstanceOf(MemoryError);
		});

		it('loads only what follows the summary when asked', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			const stored = await store.append(t.id, 'a', [
				text('1'),
				text('2'),
				text('3'),
			]);
			const through = stored[1]?.id ?? '';
			await store.setSummary(t.id, 'a', {
				text: 'sum',
				throughMessageId: through,
				tokens: 7,
			});
			const since = await store.load(t.id, 'a', { sinceSummary: true });
			expect(since?.summary).toMatchObject({
				text: 'sum',
				throughMessageId: through,
				tokens: 7,
			});
			expect(since?.messages.map((m) => m.seq)).toEqual([3]);
			const all = await store.load(t.id, 'a', { sinceSummary: false });
			expect(all?.messages).toHaveLength(3);
			await expect(
				store.setSummary(t.id, 'a', {
					text: 's',
					throughMessageId: 'missing',
					tokens: 1,
				}),
			).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });
		});

		it('finds an action from the proposed-action part', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			await store.append(t.id, 'a', [proposal('act-1')]);
			expect(await store.findAction('act-1', 'a')).toMatchObject({
				id: 'act-1',
				tool: 'archive',
				status: 'pending',
			});
			expect(await store.findAction('other', 'a')).toBeUndefined();
		});

		it('lets one of two concurrent confirmations win', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			await store.append(t.id, 'a', [proposal('act-1')]);
			const results = await Promise.all([
				store.updateAction('act-1', 'a', { status: 'confirmed' }),
				store.updateAction('act-1', 'a', { status: 'confirmed' }),
			]);
			expect(results.filter(Boolean)).toHaveLength(1);
			expect((await store.findAction('act-1', 'a'))?.status).toBe('confirmed');
			expect(
				await store.updateAction('act-1', 'a', { status: 'rejected' }),
			).toBeUndefined();
		});

		it('removes a thread together with its actions', async () => {
			const store = await make();
			const t = await store.createThread({ ownerId: 'a' });
			await store.append(t.id, 'a', [proposal('act-1')]);
			await store.deleteThread(t.id, 'a');
			expect(await store.findAction('act-1', 'a')).toBeUndefined();
		});

		it('refuses an empty owner', async () => {
			const store = await make();
			await expect(store.createThread({ ownerId: '' })).rejects.toMatchObject({
				code: 'INVALID_OWNER',
			});
		});
	});
}
