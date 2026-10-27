import { expect, it } from 'bun:test';
import { page } from './contract-fixtures';
import { MemoryError } from './errors';
import type { MemoryStore } from './types';

export function contractThreads(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
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

	it('clamps the page size to 1..100', async () => {
		const store = await make();
		for (let i = 0; i < 101; i++) await store.createThread({ ownerId: 'a' });
		const big = await store.listThreads('a', { limit: 1000 });
		expect(big.items).toHaveLength(100);
		expect(big.nextCursor).toBeDefined();
		expect((await store.listThreads('a', { limit: 0 })).items).toHaveLength(1);
	});
}
