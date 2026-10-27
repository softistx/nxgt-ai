import { assertOwner } from './guards';
import type { MongoCollection, MongoDoc } from './mongo-collection';

/** What the functions of the sibling files share. */
export interface Ctx {
	threads: MongoCollection;
	messages: MongoCollection;
	now: () => number;
	/** `{ expiresAt }` for a write at `at`, or nothing without a TTL. */
	expiry: (at: number) => MongoDoc;
}

export { assertOwner, notFound } from './guards';

export async function ownThread(c: Ctx, id: string, ownerId: string) {
	assertOwner(ownerId);
	return c.threads.findOne({ _id: id, ownerId });
}
