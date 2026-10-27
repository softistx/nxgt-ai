import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { closeRedis, connectRedis, type RedisConnection } from '@nxgt/redis';
import type { TestRedis } from '@nxgt/redis/testing';
import { startRedis } from '../test/redis';
import { redisMemory } from './redis';
import { memoryStoreContract } from './testing';
import type { MemoryStore } from './types';

let server: TestRedis;
let connection: RedisConnection;
beforeAll(async () => {
	server = await startRedis();
	connection = await connectRedis(server.uri);
});
afterAll(async () => {
	await closeRedis();
	await server.stop();
});

/** A store over an empty Redis; `now` defaults to the real clock. */
async function setup(
	options: { expireAfterSeconds?: number; now?: () => number } = {},
) {
	await server.reset();
	const client = connection.client;
	return { client, store: redisMemory({ client, ...options }) };
}

memoryStoreContract(async (): Promise<MemoryStore> => (await setup()).store);

const user = (t: string) => ({
	role: 'user' as const,
	parts: [{ type: 'text' as const, text: t }],
});

const proposal = {
	role: 'assistant' as const,
	parts: [
		{
			type: 'proposed-action' as const,
			id: 'p1',
			tool: 'x',
			input: {},
			expiresAt: 9,
		},
	],
};

describe('redisMemory', () => {
	it('writes only keys under its prefix', async () => {
		const { client, store } = await setup();
		const t = await store.createThread({ ownerId: 'a', title: 'x', meta: {} });
		await store.append(t.id, 'a', [proposal]);
		const found = (await client.send('KEYS', ['*'])) as string[];
		expect(found.length).toBeGreaterThan(0);
		expect(found.every((k) => k.startsWith('ai-memory:'))).toBe(true);
		const other = redisMemory({ client, prefix: 'chat' });
		await other.createThread({ ownerId: 'a' });
		expect(((await client.send('KEYS', ['chat:*'])) as string[]).length).toBe(
			2,
		);
	});

	it('gives concurrent appends distinct, gapless seqs', async () => {
		const { store } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				store.append(t.id, 'a', [user(`m${i}`), user(`n${i}`)]),
			),
		);
		const loaded = await store.load(t.id, 'a', { sinceSummary: false });
		expect(loaded?.messages.map((m) => m.seq)).toEqual(
			Array.from({ length: 20 }, (_, i) => i + 1),
		);
		expect(loaded?.thread.messageCount).toBe(20);
	});

	it('records an action id once per owner', async () => {
		const { client, store } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal, proposal]);
		await store.append(t.id, 'a', [proposal]);
		const found = (await client.send('KEYS', [
			'ai-memory:action:*',
		])) as string[];
		expect(found).toEqual(['ai-memory:action:a:p1']);
	});

	it('lets only one of two concurrent confirmations win', async () => {
		const { store } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal]);
		const results = await Promise.all([
			store.updateAction('p1', 'a', { status: 'confirmed' }),
			store.updateAction('p1', 'a', { status: 'rejected' }),
		]);
		expect(results.filter((r) => r !== undefined)).toHaveLength(1);
	});

	it('sets a TTL only with expireAfterSeconds, and slides it on a write', async () => {
		const plain = await setup();
		const a = await plain.store.createThread({ ownerId: 'a' });
		expect(await plain.client.send('PTTL', [`ai-memory:thread:${a.id}`])).toBe(
			-1,
		);

		const { client, store } = await setup({ expireAfterSeconds: 60 });
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [user('x')]);
		for (const key of ['thread', 'messages', 'ids']) {
			const left = (await client.send('PTTL', [
				`ai-memory:${key}:${t.id}`,
			])) as number;
			expect(left).toBeGreaterThan(50_000);
			expect(left).toBeLessThanOrEqual(60_000);
		}
		expect(await store.getThread(t.id, 'a')).not.toHaveProperty('expiresAt');
	});

	it('honours the clock for expiry and cleans the owner index', async () => {
		const { client, store } = await setup({
			expireAfterSeconds: 60,
			now: () => 1_000_000,
		});
		const t = await store.createThread({ ownerId: 'a' });
		expect(await store.getThread(t.id, 'a')).toBeUndefined();
		expect(await store.listThreads('a')).toEqual({ items: [] });
		expect(await client.send('ZCARD', ['ai-memory:owner:a'])).toBe(0);
	});

	it('deletes the messages before the thread', async () => {
		const { client, store } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal]);
		const order: string[] = [];
		const wrapped = redisMemory({
			client: {
				send: (command, args) => {
					if (command === 'DEL') order.push(args[0] as string);
					return client.send(command, args);
				},
			},
		});
		expect(await wrapped.deleteThread(t.id, 'a')).toBe(true);
		expect(order).toEqual([
			`ai-memory:messages:${t.id}`,
			`ai-memory:thread:${t.id}`,
		]);
		expect(await client.send('KEYS', ['*'])).toEqual([]);
	});
});
