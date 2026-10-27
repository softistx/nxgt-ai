import { MemoryError } from './errors';
import type { MongoCollection, MongoDoc } from './mongo-collection';

/** What the functions of the sibling files share. */
export interface Ctx {
	threads: MongoCollection;
	messages: MongoCollection;
	now: () => number;
	/** `{ expiresAt }` for a write at `at`, or nothing without a TTL. */
	expiry: (at: number) => MongoDoc;
}

export function assertOwner(ownerId: string): void {
	if (typeof ownerId !== 'string' || ownerId === '') {
		throw new MemoryError(
			'INVALID_OWNER',
			'ownerId must be a non-empty string.',
		);
	}
}

export const notFound = (id: string): MemoryError =>
	new MemoryError('THREAD_NOT_FOUND', `Thread "${id}" was not found.`);

export async function ownThread(c: Ctx, id: string, ownerId: string) {
	assertOwner(ownerId);
	return c.threads.findOne({ _id: id, ownerId });
}
