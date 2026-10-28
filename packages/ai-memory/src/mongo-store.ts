import * as actions from './mongo-actions';
import type { MongoCollection } from './mongo-collection';
import type { Ctx } from './mongo-ctx';
import * as messages from './mongo-messages';
import { checkScope, type MongoScope } from './mongo-scope';
import * as threads from './mongo-threads';
import type { MemoryStore } from './types';

export interface MongoMemoryOptions {
	threads: MongoCollection;
	messages: MongoCollection;
	/**
	 * Documents expire this long after their last write (a thread) or their
	 * insert (a message); needs `expiresAtIndex` on both collections.
	 */
	expireAfterSeconds?: number;
	/**
	 * Tenant fields for a collection shared by several tenants (see the
	 * multi-tenant section of the guide): merged into every filter, stamped on
	 * every insert and never written by an update. Pass the driver collection
	 * with it. Names the store writes itself are refused (`INVALID_SCOPE`).
	 */
	scope?: MongoScope;
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

/** A store over two MongoDB collections; see the guide for indexes and TTL. */
export function mongoMemory(options: MongoMemoryOptions): MemoryStore {
	const ttl = options.expireAfterSeconds;
	const c: Ctx = {
		threads: options.threads,
		messages: options.messages,
		scope: checkScope(options.scope),
		now: options.now ?? Date.now,
		expiry: (at) =>
			ttl === undefined ? {} : { expiresAt: new Date(at + ttl * 1000) },
	};
	return {
		createThread: (input) => threads.createThread(c, input),
		getThread: (id, ownerId) => threads.getThread(c, id, ownerId),
		listThreads: (ownerId, page = {}) => threads.listThreads(c, ownerId, page),
		append: (id, ownerId, list) => messages.append(c, id, ownerId, list),
		load: (id, ownerId, opts) => messages.load(c, id, ownerId, opts),
		setSummary: (id, ownerId, input) =>
			messages.setSummary(c, id, ownerId, input),
		findAction: (id, ownerId) => actions.findAction(c, id, ownerId),
		updateAction: (id, ownerId, patch) =>
			actions.updateAction(c, id, ownerId, patch),
		deleteThread: (id, ownerId) => threads.deleteThread(c, id, ownerId),
	};
}
