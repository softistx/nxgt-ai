import { expect, it } from 'bun:test';
import { proposal, text } from './contract-fixtures';
import type { MemoryStore } from './types';

export function contractOwner(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
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
		// Settled together: a store may answer the second call before the
		// first, and a rejection nobody awaits yet is reported as unhandled.
		const settled = await Promise.allSettled(denied);
		for (const outcome of settled) {
			expect(outcome.status).toBe('rejected');
			expect((outcome as PromiseRejectedResult).reason).toMatchObject({
				code: 'THREAD_NOT_FOUND',
			});
		}
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
		expect(
			(await store.load(t.id, 'a', { sinceSummary: false }))?.messages,
		).toHaveLength(1);
	});

	it('refuses an empty owner on every call', async () => {
		const store = await make();
		const calls = [
			store.createThread({ ownerId: '' }),
			store.getThread('x', ''),
			store.listThreads(''),
			store.findAction('x', ''),
		];
		for (const call of calls) {
			await expect(call).rejects.toMatchObject({ code: 'INVALID_OWNER' });
		}
	});
}
