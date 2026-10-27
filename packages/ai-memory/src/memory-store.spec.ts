import { describe, expect, it } from 'bun:test';
import { MemoryError, memoryStore } from './index';
import { memoryStoreContract } from './testing';

memoryStoreContract(() => memoryStore());

describe('memoryStore', () => {
	it('uses the injected clock', async () => {
		const store = memoryStore({ now: () => 42 });
		const t = await store.createThread({ ownerId: 'a' });
		expect(t.createdAt).toBe(42);
	});

	it('does not leak its state through returned objects', async () => {
		const store = memoryStore();
		const t = await store.createThread({ ownerId: 'a', meta: { k: 1 } });
		if (t.meta) t.meta['k'] = 2;
		expect((await store.getThread(t.id, 'a'))?.meta).toEqual({ k: 1 });
	});

	it('raises a MemoryError', async () => {
		const err = await memoryStore()
			.append('missing', 'a', [])
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(MemoryError);
	});
});
