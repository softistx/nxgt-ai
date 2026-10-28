import type { MongoDoc } from './mongo-collection';
import { assertOwner, type Ctx, ownThread } from './mongo-ctx';
import { toThread } from './mongo-map';
import { assertUuidCursor, pageLimit } from './paging';
import type { CreateThreadInput, Page, Thread, ThreadPage } from './types';

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
	const limit = pageLimit(page);
	assertUuidCursor(page.cursor);
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
 * Messages, the thread, then the messages again. A crash in between leaves an
 * empty thread that a retry removes. An `append` racing the delete either
 * inserts before the last sweep (removed here) or checks the thread after its
 * insert and removes its own batch.
 */
export async function deleteThread(c: Ctx, id: string, ownerId: string) {
	if (!(await ownThread(c, id, ownerId))) return false;
	await c.messages.deleteMany({ threadId: id, ownerId });
	await c.threads.deleteOne({ _id: id, ownerId });
	await c.messages.deleteMany({ threadId: id, ownerId });
	return true;
}
