import { MemoryError } from './errors';

/**
 * The fields the store writes on a thread document. `_id` is the thread id.
 * `expiresAt` is a `Date`, set only with `expireAfterSeconds`.
 */
export const threadFields = {
	id: '_id',
	ownerId: 'ownerId',
	title: 'title',
	meta: 'meta',
	messageCount: 'messageCount',
	summary: 'summary',
	createdAt: 'createdAt',
	updatedAt: 'updatedAt',
	expiresAt: 'expiresAt',
} as const;

/**
 * The fields the store writes on a message document. `_id` is the message id;
 * `actions` holds the state of the proposed actions the message carries.
 */
export const messageFields = {
	id: '_id',
	threadId: 'threadId',
	ownerId: 'ownerId',
	seq: 'seq',
	message: 'message',
	createdAt: 'createdAt',
	actions: 'actions',
	expiresAt: 'expiresAt',
} as const;

export interface MongoIndex {
	key: Record<string, 1 | -1>;
	unique?: boolean;
	expireAfterSeconds?: number;
}

/** Indexes to create on the threads collection (`createIndex(key, options)`). */
export const threadIndexes: readonly MongoIndex[] = [
	{ key: { ownerId: 1, _id: -1 } },
];

/** Indexes to create on the messages collection. */
export const messageIndexes: readonly MongoIndex[] = [
	{ key: { ownerId: 1, threadId: 1, seq: 1 }, unique: true },
	{ key: { ownerId: 1, 'actions.id': 1 } },
];

export interface IndexPrefix {
	/** Ordered keys put in front of each index, usually the scope's fields. */
	prefix: Record<string, 1 | -1>;
}

const prefixed = (
	list: readonly MongoIndex[],
	{ prefix }: IndexPrefix,
): MongoIndex[] =>
	list.map((index) => {
		for (const name of Object.keys(prefix)) {
			if (name in index.key) {
				throw new MemoryError(
					'INVALID_SCOPE',
					`Index prefix field "${name}" is already a key of the index.`,
				);
			}
		}
		return { ...index, key: { ...prefix, ...index.key } };
	});

/** `threadIndexes` led by the scope's keys, for a `mongoMemory({ scope })` store. */
export const scopedThreadIndexes = (options: IndexPrefix): MongoIndex[] =>
	prefixed(threadIndexes, options);

/** `messageIndexes` led by the scope's keys; the unique index stays unique per tenant. */
export const scopedMessageIndexes = (options: IndexPrefix): MongoIndex[] =>
	prefixed(messageIndexes, options);

/** The TTL index, on both collections, when `expireAfterSeconds` is set (never prefixed). */
export const expiresAtIndex: MongoIndex = {
	key: { expiresAt: 1 },
	expireAfterSeconds: 0,
};
