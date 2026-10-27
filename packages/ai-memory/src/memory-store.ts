import * as actions from './actions';
import * as messages from './messages';
import type { State } from './state';
import * as threads from './threads';
import type { MemoryStore } from './types';

export interface MemoryStoreOptions {
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

/** A store that keeps everything in this process; for tests and small tools. */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
	const s: State = {
		now: options.now ?? Date.now,
		threads: new Map(),
		actions: new Map(),
		counter: 0,
	};
	return {
		createThread: async (input) => threads.createThread(s, input),
		getThread: async (id, ownerId) => threads.getThread(s, id, ownerId),
		listThreads: async (ownerId, page = {}) =>
			threads.listThreads(s, ownerId, page),
		append: async (id, ownerId, list) => messages.append(s, id, ownerId, list),
		load: async (id, ownerId, opts) => messages.load(s, id, ownerId, opts),
		setSummary: async (id, ownerId, input) =>
			messages.setSummary(s, id, ownerId, input),
		findAction: async (id, ownerId) => actions.findAction(s, id, ownerId),
		updateAction: async (id, ownerId, patch) =>
			actions.updateAction(s, id, ownerId, patch),
		deleteThread: async (id, ownerId) => threads.deleteThread(s, id, ownerId),
	};
}
