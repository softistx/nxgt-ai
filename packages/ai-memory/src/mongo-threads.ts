import { MemoryError } from './errors';
import type { MongoDoc } from './mongo-collection';
import { assertOwner, type Ctx, ownThread } from './mongo-ctx';
import { toThread } from './mongo-map';
import type { CreateThreadInput, Page, Thread, ThreadPage } from './types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createThread(
	c: Ctx,
	input: CreateThreadInput,
): Promise<Thread> {
	assertOwner(input.ownerId);
	const at = c.now();
	const doc: MongoDoc = {
		_id: Bun.randomUUIDv7(),
		ownerId: input.ownerId,
		...(input.title === undefined ? {} : { title: input.title }),
		...(input.meta === undefined ? {} : { meta: input.meta }),
		messageCount: 0,
		createdAt: at,
		updatedAt: at,
		...c.expiry(at),
	};
	await c.threads.insertOne(doc);
	return toThread(doc);
}

export async function getThread(c: Ctx, id: string, ownerId: string) {
	const doc = await ownThread(c, id, ownerId);
	return doc ? toThread(doc) : undefined;
}

export async function listThreads(
	c: Ctx,
	ownerId: string,
	page: Page,
): Promise<ThreadPage> {
	assertOwner(ownerId);
	const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	if (page.cursor !== undefined && !CURSOR.test(page.cursor)) {
		throw new MemoryError(
			'INVALID_CURSOR',
			`"${page.cursor}" is not a cursor this store gave.`,
		);
	}
	const docs = await c.threads
		.find({
			ownerId,
			...(page.cursor === undefined ? {} : { _id: { $lt: page.cursor } }),
		})
		.sort({ _id: -1 })
		.limit(limit + 1)
		.toArray();
	const items = docs.slice(0, limit);
	const last = items[items.length - 1];
	return {
		items: items.map(toThread),
		...(docs.length > limit && last
			? { nextCursor: last['_id'] as string }
			: {}),
	};
}

/**
 * Messages first, then the thread: a crash in between leaves an empty thread
 * that a retry removes, never messages nobody can reach.
 */
export async function deleteThread(c: Ctx, id: string, ownerId: string) {
	if (!(await ownThread(c, id, ownerId))) return false;
	await c.messages.deleteMany({ threadId: id, ownerId });
	await c.threads.deleteOne({ _id: id, ownerId });
	return true;
}
