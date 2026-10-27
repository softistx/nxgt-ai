import { expect, it } from 'bun:test';
import { proposal } from './contract-fixtures';
import type { MemoryStore } from './types';

export function contractActions(
	make: () => MemoryStore | Promise<MemoryStore>,
): void {
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

	it('keeps the same action id apart for two owners', async () => {
		const store = await make();
		const a = await store.createThread({ ownerId: 'a' });
		const b = await store.createThread({ ownerId: 'b' });
		await store.append(b.id, 'b', [proposal('act-1')]);
		await store.append(a.id, 'a', [proposal('act-1')]);
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
		await store.updateAction('act-1', 'b', { status: 'rejected' });
		expect((await store.findAction('act-1', 'a'))?.status).toBe('pending');
	});

	it('records the result of a settled action', async () => {
		const store = await make();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal('act-1')]);
		const result = {
			type: 'tool-result',
			callId: 'c1',
			name: 'archive',
			isError: false,
			output: { ok: true },
		} as const;
		const done = await store.updateAction('act-1', 'a', {
			status: 'confirmed',
			result,
		});
		expect(done?.result).toEqual(result);
	});
}
