import * as actions from './redis-actions';
import type { Ctx, RedisCommands } from './redis-ctx';
import * as messages from './redis-messages';
import * as threads from './redis-threads';
import type { MemoryStore } from './types';

export interface RedisMemoryOptions {
	/**
	 * The client: `connection.client` of `connectRedis`, or the `client` of an
	 * instance of `openRedis`, both from `@nxgt/redis`.
	 */
	client: RedisCommands;
	/** What every key starts with; default `ai-memory`. */
	prefix?: string;
	/**
	 * Keys expire this long after the thread's last write, so the whole thread
	 * goes together.
	 */
	expireAfterSeconds?: number;
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

/** A store over Redis keys; see the guide for the layout, expiry and limits. */
export function redisMemory(options: RedisMemoryOptions): MemoryStore {
	const ttl = options.expireAfterSeconds;
	const c: Ctx = {
		redis: options.client,
		prefix: options.prefix ?? 'ai-memory',
		now: options.now ?? Date.now,
		expireAt: (at) => (ttl === undefined ? '0' : String(at + ttl * 1000)),
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
