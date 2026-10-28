import { assertOwner } from './guards';
import type { MongoCollection, MongoDoc } from './mongo-collection';

/** What the functions of the sibling files share. */
export interface Ctx {
	threads: MongoCollection;
	messages: MongoCollection;
	now: () => number;
	/** `{ expiresAt }` for a write at `at`, or nothing without a TTL. */
	expiry: (at: number) => MongoDoc;
	/** The tenant fields merged into every filter and stamped on every insert. */
	scope: Readonly<MongoDoc>;
}

/** A filter narrowed to the scope (scope keys are reserved, so none can collide). */
export function scoped(c: Ctx, filter: MongoDoc): MongoDoc {
	return { ...filter, ...c.scope };
}

export { assertOwner, notFound } from './guards';

export async function ownThread(c: Ctx, id: string, ownerId: string) {
	assertOwner(ownerId);
	return c.threads.findOne(scoped(c, { _id: id, ownerId }));
}
