import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Db } from 'mongodb';
import { startMongo, type TestMongo } from '../test/mongo';
import {
	expiresAtIndex,
	type MongoIndex,
	messageFields,
	messageIndexes,
	mongoMemory,
	threadFields,
	threadIndexes,
} from './mongo';
import { memoryStoreContract } from './testing';
import type { MemoryStore } from './types';

let mongo: TestMongo;
beforeAll(async () => {
	mongo = await startMongo();
});
afterAll(async () => {
	await mongo.stop();
});

async function indexed(db: Db, name: string, list: readonly MongoIndex[]) {
	for (const { key, ...options } of list) {
		await db.collection(name).createIndex(key, options);
	}
}

/** Fresh collections with the documented indexes; a driver Collection is passed as is. */
async function setup(expireAfterSeconds?: number) {
	const db = await mongo.fresh();
	const ttl = expireAfterSeconds === undefined ? [] : [expiresAtIndex];
	await indexed(db, 'threads', [...threadIndexes, ...ttl]);
	await indexed(db, 'messages', [...messageIndexes, ...ttl]);
	const threads = db.collection('threads');
	const messages = db.collection('messages');
	const store = mongoMemory({
		threads,
		messages,
		...(expireAfterSeconds === undefined ? {} : { expireAfterSeconds }),
		now: () => 1_000_000,
	});
	return { db, threads, messages, store };
}

memoryStoreContract(async (): Promise<MemoryStore> => (await setup()).store);

const user = (t: string) => ({
	role: 'user' as const,
	parts: [{ type: 'text' as const, text: t }],
});

describe('mongoMemory', () => {
	it('writes only the documented fields', async () => {
		const { threads, messages, store } = await setup(60);
		const t = await store.createThread({ ownerId: 'a', title: 'x', meta: {} });
		await store.append(t.id, 'a', [
			{
				role: 'assistant',
				parts: [
					{
						type: 'proposed-action',
						id: 'p1',
						tool: 'x',
						input: {},
						expiresAt: 1,
					},
				],
			},
		]);
		await store.setSummary(t.id, 'a', {
			text: 's',
			throughMessageId: (await store.load(t.id, 'a', { sinceSummary: false }))
				?.messages[0]?.id as string,
			tokens: 1,
		});
		const threadDoc = await threads.findOne({});
		const messageDoc = await messages.findOne({});
		const allowed = (fields: Record<string, string>) => Object.values(fields);
		expect(allowed(threadFields)).toEqual(
			expect.arrayContaining(Object.keys(threadDoc ?? {})),
		);
		expect(allowed(messageFields)).toEqual(
			expect.arrayContaining(Object.keys(messageDoc ?? {})),
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
		const { store, messages } = await setup();
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
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [proposal, proposal]);
		await store.append(t.id, 'a', [proposal]);
		expect(await messages.countDocuments({ 'actions.id': 'p1' })).toBe(1);
	});

	it('stamps expiresAt only with expireAfterSeconds, and slides the thread', async () => {
		const plain = await setup();
		const a = await plain.store.createThread({ ownerId: 'a' });
		expect(
			await plain.threads.findOne({ _id: a.id as never }),
		).not.toHaveProperty('expiresAt');

		const { store, threads, messages } = await setup(60);
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [user('x')]);
		const expected = new Date(1_000_000 + 60_000);
		expect((await threads.findOne({}))?.['expiresAt']).toEqual(expected);
		expect((await messages.findOne({}))?.['expiresAt']).toEqual(expected);
		expect(await store.getThread(t.id, 'a')).not.toHaveProperty('expiresAt');
	});

	it('creates the TTL index with a zero delay on expiresAt', async () => {
		const { db } = await setup(60);
		const indexes = await db.collection('threads').indexes();
		expect(indexes.find((i) => i.key['expiresAt'] === 1)).toMatchObject({
			expireAfterSeconds: 0,
		});
	});

	it('deletes the messages before the thread', async () => {
		const { store, threads, messages } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		await store.append(t.id, 'a', [user('x')]);
		const order: string[] = [];
		const spy = (name: string, coll: typeof threads) =>
			new Proxy(coll, {
				get(target, prop, receiver) {
					if (prop === 'deleteOne' || prop === 'deleteMany') order.push(name);
					return Reflect.get(target, prop, receiver);
				},
			});
		const wrapped = mongoMemory({
			threads: spy('threads', threads),
			messages: spy('messages', messages),
		});
		expect(await wrapped.deleteThread(t.id, 'a')).toBe(true);
		expect(order).toEqual(['messages', 'threads']);
		expect(await messages.countDocuments({})).toBe(0);
	});
});
