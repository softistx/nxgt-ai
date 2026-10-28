import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type Db, ObjectId } from 'mongodb';
import { startMongo, type TestMongo } from '../test/mongo';
import {
	expiresAtIndex,
	type MongoIndex,
	messageFields,
	messageIndexes,
	mongoMemory,
	scopedMessageIndexes,
	scopedThreadIndexes,
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

/** One shared pair of collections, a store per tenant. */
async function tenants() {
	const db = await mongo.fresh();
	await indexed(
		db,
		'threads',
		scopedThreadIndexes({ prefix: { tenantId: 1 } }),
	);
	await indexed(
		db,
		'messages',
		scopedMessageIndexes({ prefix: { tenantId: 1 } }),
	);
	const threads = db.collection('threads');
	const messages = db.collection('messages');
	const store = (tenantId: string) =>
		mongoMemory({ threads, messages, scope: { tenantId } });
	return { db, threads, messages, store };
}

// The whole contract, in a collection another tenant also writes to.
memoryStoreContract(async (): Promise<MemoryStore> => {
	const { store } = await tenants();
	const other = store('other');
	const t = await other.createThread({ ownerId: 'owner-a' });
	await other.append(t.id, 'owner-a', [
		{ role: 'user', parts: [{ type: 'text', text: 'noise' }] },
	]);
	return store('t1');
});

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

	it('moves every message of a thread to its expiry on each write', async () => {
		let at = 1_000_000;
		const db = await mongo.fresh();
		const threads = db.collection('threads');
		const messages = db.collection('messages');
		const store = mongoMemory({
			threads,
			messages,
			expireAfterSeconds: 60,
			now: () => at,
		});
		const t = await store.createThread({ ownerId: 'a' });
		const [first] = await store.append(t.id, 'a', [user('one')]);
		at = 1_030_000;
		await store.append(t.id, 'a', [user('two')]);
		at = 1_050_000;
		await store.setSummary(t.id, 'a', {
			text: 's',
			throughMessageId: first?.id ?? '',
			tokens: 1,
		});
		const expected = new Date(1_050_000 + 60_000);
		const stamps = await messages.find({}).toArray();
		expect(stamps).toHaveLength(2);
		for (const doc of stamps) expect(doc['expiresAt']).toEqual(expected);
		expect((await threads.findOne({}))?.['expiresAt']).toEqual(expected);
	});

	it('removes the batch of an append that lost the race with deleteThread', async () => {
		const { store, threads, messages } = await setup();
		const t = await store.createThread({ ownerId: 'a' });
		const racing = new Proxy(messages, {
			get(target, prop) {
				if (prop !== 'insertMany') return Reflect.get(target, prop, target);
				return async (docs: never[]) => {
					const done = await target.insertMany(docs);
					await threads.deleteOne({ _id: t.id as never });
					return done;
				};
			},
		});
		const raced = mongoMemory({
			threads,
			messages: racing as never,
			now: () => 1_000_000,
		});
		await expect(raced.append(t.id, 'a', [user('x')])).rejects.toMatchObject({
			code: 'THREAD_NOT_FOUND',
		});
		expect(await messages.countDocuments({})).toBe(0);
	});

	it('creates the TTL index with a zero delay on expiresAt', async () => {
		const { db } = await setup(60);
		const indexes = await db.collection('threads').indexes();
		expect(indexes.find((i) => i.key['expiresAt'] === 1)).toMatchObject({
			expireAfterSeconds: 0,
		});
	});

	it('sweeps the messages around the thread', async () => {
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
		expect(order).toEqual(['messages', 'threads', 'messages']);
		expect(await messages.countDocuments({})).toBe(0);
	});
});

const proposal = {
	role: 'assistant' as const,
	parts: [
		{
			type: 'proposed-action' as const,
			id: 'same-id',
			tool: 'x',
			input: {},
			expiresAt: 9,
		},
	],
};

describe('mongoMemory scope', () => {
	it('keeps two tenants with the same ownerId and ids apart', async () => {
		const { store, threads, messages } = await tenants();
		const a = store('a');
		const b = store('b');
		const ta = await a.createThread({ ownerId: 'u' });
		const tb = await b.createThread({ ownerId: 'u' });
		await a.append(ta.id, 'u', [user('from a'), proposal]);
		await b.append(tb.id, 'u', [user('from b'), proposal]);

		// Same ownerId and the other tenant's thread id: invisible.
		expect(await a.getThread(tb.id, 'u')).toBeUndefined();
		expect(await a.load(tb.id, 'u', { sinceSummary: false })).toBeUndefined();
		expect((await a.listThreads('u')).items.map((t) => t.id)).toEqual([ta.id]);
		expect((await b.listThreads('u')).items.map((t) => t.id)).toEqual([tb.id]);
		await expect(a.append(tb.id, 'u', [user('x')])).rejects.toMatchObject({
			code: 'THREAD_NOT_FOUND',
		});
		expect(await a.deleteThread(tb.id, 'u')).toBe(false);
		expect(await a.getThread(ta.id, 'u')).not.toHaveProperty('tenantId');

		// The same action id is recorded and settled once per tenant.
		expect(await messages.countDocuments({ 'actions.id': 'same-id' })).toBe(2);
		expect(
			await a.updateAction('same-id', 'u', { status: 'confirmed' }),
		).toMatchObject({
			status: 'confirmed',
		});
		expect((await b.findAction('same-id', 'u'))?.status).toBe('pending');

		// A summary cannot point at the other tenant's message.
		const [mb] =
			(await b.load(tb.id, 'u', { sinceSummary: false }))?.messages ?? [];
		await expect(
			a.setSummary(ta.id, 'u', {
				text: 's',
				throughMessageId: mb?.id ?? '',
				tokens: 1,
			}),
		).rejects.toMatchObject({ code: 'MESSAGE_NOT_FOUND' });

		// Deleting in a leaves b untouched.
		expect(await a.deleteThread(ta.id, 'u')).toBe(true);
		expect(await threads.countDocuments({ tenantId: 'b' })).toBe(1);
		expect(await messages.countDocuments({ tenantId: 'b' })).toBe(2);
		expect(await messages.countDocuments({ tenantId: 'a' })).toBe(0);
	});

	it('stamps the scope on every insert', async () => {
		const { store, threads, messages } = await tenants();
		const s = store('a');
		const t = await s.createThread({ ownerId: 'u' });
		await s.append(t.id, 'u', [user('x')]);
		expect(await threads.countDocuments({ tenantId: 'a' })).toBe(1);
		expect(await messages.countDocuments({ tenantId: 'a' })).toBe(1);
	});

	it('never lets an update change the scope', async () => {
		const { store, threads, messages } = await tenants();
		const s = store('a');
		// Caller data named like the scope stays in meta and cannot reach it.
		const t = await s.createThread({
			ownerId: 'u',
			meta: { tenantId: 'b' },
		});
		const [m] = await s.append(t.id, 'u', [user('x'), proposal]);
		await s.setSummary(t.id, 'u', {
			text: 's',
			throughMessageId: m?.id ?? '',
			tokens: 1,
		});
		await s.updateAction('same-id', 'u', {
			status: 'confirmed',
			result: { tenantId: 'b' } as never,
		});
		for (const doc of [
			...(await threads.find({}).toArray()),
			...(await messages.find({}).toArray()),
		]) {
			expect(doc['tenantId']).toBe('a');
		}
		expect(await store('b').getThread(t.id, 'u')).toBeUndefined();
	});

	it('refuses a scope that could be overridden or turned into an operator', () => {
		const make = (scope: never) => () =>
			mongoMemory({ threads: {} as never, messages: {} as never, scope });
		for (const scope of [
			{ ownerId: 'x' },
			{ _id: 'x' },
			{ meta: 'x' },
			{ $or: 'x' },
			{ 'a.b': 'x' },
			{ '': 'x' },
			{ tenantId: { $ne: 'a' } },
			{ tenantId: ['a'] },
			{ tenantId: null },
			{ tenantId: undefined },
			{ tenantId: Number.NaN },
		]) {
			expect(make(scope as never)).toThrow(
				expect.objectContaining({ code: 'INVALID_SCOPE' }),
			);
		}
		expect(
			make({ tenantId: new ObjectId(), n: 1, on: true } as never),
		).not.toThrow();
	});

	it('works with an ObjectId scope value', async () => {
		const db = await mongo.fresh();
		const threads = db.collection('threads');
		const messages = db.collection('messages');
		const a = mongoMemory({
			threads,
			messages,
			scope: { org: new ObjectId() },
		});
		const b = mongoMemory({
			threads,
			messages,
			scope: { org: new ObjectId() },
		});
		const t = await a.createThread({ ownerId: 'u' });
		expect(await a.getThread(t.id, 'u')).toBeDefined();
		expect(await b.getThread(t.id, 'u')).toBeUndefined();
	});

	it('leads every index with the prefix, and leaves the TTL index alone', async () => {
		const prefix = { tenantId: 1, region: -1 } as const;
		expect(scopedThreadIndexes({ prefix })).toEqual([
			{ key: { tenantId: 1, region: -1, ownerId: 1, _id: -1 } },
		]);
		expect(scopedMessageIndexes({ prefix })).toEqual([
			{
				key: { tenantId: 1, region: -1, ownerId: 1, threadId: 1, seq: 1 },
				unique: true,
			},
			{ key: { tenantId: 1, region: -1, ownerId: 1, 'actions.id': 1 } },
		]);
		// The unprefixed exports are untouched.
		expect(threadIndexes).toEqual([{ key: { ownerId: 1, _id: -1 } }]);
		const { db } = await tenants();
		const keys = (await db.collection('messages').indexes()).map((i) =>
			Object.keys(i.key).join(','),
		);
		expect(keys).toContain('tenantId,ownerId,threadId,seq');
		expect(
			(await db.collection('messages').indexes()).find((i) => i.unique),
		).toBeDefined();
	});
});
