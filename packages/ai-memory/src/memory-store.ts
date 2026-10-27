import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { MemoryError } from './errors';
import { messageSchema } from './schemas';
import type {
	ActionPatch,
	CreateThreadInput,
	LoadedThread,
	LoadOptions,
	MemoryStore,
	Page,
	StoredMessage,
	SummaryInput,
	Thread,
	ThreadPage,
	ThreadSummary,
} from './types';

export interface MemoryStoreOptions {
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ThreadRecord {
	thread: Thread;
	/** Creation order across the store; the list cursor. */
	order: number;
	messages: StoredMessage[];
}

interface ActionRecord {
	ownerId: string;
	threadId: string;
	action: ProposedAction;
}

function assertOwner(ownerId: string): void {
	if (typeof ownerId !== 'string' || ownerId === '') {
		throw new MemoryError(
			'INVALID_OWNER',
			'ownerId must be a non-empty string.',
		);
	}
}

function parseCursor(cursor: string): number {
	const order = /^\d+$/.test(cursor) ? Number(cursor) : Number.NaN;
	if (!Number.isSafeInteger(order)) {
		throw new MemoryError(
			'INVALID_CURSOR',
			`"${cursor}" is not a cursor this store gave.`,
		);
	}
	return order;
}

/** A store that keeps everything in this process; for tests and small tools. */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
	const now = options.now ?? Date.now;
	const threads = new Map<string, ThreadRecord>();
	const actions = new Map<string, ActionRecord>();
	let counter = 0;

	/** The owner's thread, or undefined for an absent or foreign one. */
	function own(id: string, ownerId: string): ThreadRecord | undefined {
		assertOwner(ownerId);
		const record = threads.get(id);
		return record?.thread.ownerId === ownerId ? record : undefined;
	}

	function ownOrThrow(id: string, ownerId: string): ThreadRecord {
		const record = own(id, ownerId);
		if (!record)
			throw new MemoryError(
				'THREAD_NOT_FOUND',
				`Thread "${id}" was not found.`,
			);
		return record;
	}

	function keepActions(record: ThreadRecord, message: Message): void {
		for (const part of message.parts) {
			if (part.type !== 'proposed-action' || actions.has(part.id)) continue;
			actions.set(part.id, {
				ownerId: record.thread.ownerId,
				threadId: record.thread.id,
				action: toProposedAction(part),
			});
		}
	}

	return {
		async createThread(input: CreateThreadInput): Promise<Thread> {
			assertOwner(input.ownerId);
			const at = now();
			const thread: Thread = {
				id: crypto.randomUUID(),
				ownerId: input.ownerId,
				...(input.title === undefined ? {} : { title: input.title }),
				...(input.meta === undefined
					? {}
					: { meta: structuredClone(input.meta) }),
				messageCount: 0,
				createdAt: at,
				updatedAt: at,
			};
			threads.set(thread.id, { thread, order: ++counter, messages: [] });
			return structuredClone(thread);
		},

		async getThread(id, ownerId) {
			const record = own(id, ownerId);
			return record && structuredClone(record.thread);
		},

		async listThreads(ownerId, page: Page = {}): Promise<ThreadPage> {
			assertOwner(ownerId);
			const limit = Math.min(
				Math.max(page.limit ?? DEFAULT_LIMIT, 1),
				MAX_LIMIT,
			);
			const before =
				page.cursor === undefined ? Infinity : parseCursor(page.cursor);
			const mine = [...threads.values()]
				.filter((r) => r.thread.ownerId === ownerId && r.order < before)
				.sort((a, b) => b.order - a.order);
			const items = mine.slice(0, limit);
			const last = items[items.length - 1];
			return {
				items: items.map((r) => structuredClone(r.thread)),
				...(mine.length > limit && last
					? { nextCursor: String(last.order) }
					: {}),
			};
		},

		async append(threadId, ownerId, messages) {
			const record = ownOrThrow(threadId, ownerId);
			const parsed = messages.map((m) => messageSchema.parse(m) as Message);
			const at = now();
			const stored = parsed.map(
				(message, i): StoredMessage => ({
					id: crypto.randomUUID(),
					threadId,
					seq: record.messages.length + i + 1,
					message: structuredClone(message),
					createdAt: at,
				}),
			);
			for (const s of stored) {
				record.messages.push(s);
				keepActions(record, s.message);
			}
			record.thread.messageCount = record.messages.length;
			record.thread.updatedAt = at;
			return structuredClone(stored);
		},

		async load(
			threadId,
			ownerId,
			options: LoadOptions,
		): Promise<LoadedThread | undefined> {
			const record = own(threadId, ownerId);
			if (!record) return undefined;
			const { summary } = record.thread;
			let messages = record.messages;
			if (options.sinceSummary && summary) {
				const through = messages.find((m) => m.id === summary.throughMessageId);
				messages = messages.filter((m) => m.seq > (through?.seq ?? 0));
			}
			return structuredClone({
				thread: record.thread,
				...(summary ? { summary } : {}),
				messages,
			});
		},

		async setSummary(
			threadId,
			ownerId,
			input: SummaryInput,
		): Promise<ThreadSummary> {
			const record = ownOrThrow(threadId, ownerId);
			if (!record.messages.some((m) => m.id === input.throughMessageId)) {
				throw new MemoryError(
					'MESSAGE_NOT_FOUND',
					`Message "${input.throughMessageId}" is not in thread "${threadId}".`,
				);
			}
			const at = now();
			record.thread.summary = { ...input, createdAt: at };
			record.thread.updatedAt = at;
			return structuredClone(record.thread.summary);
		},

		async findAction(actionId, ownerId) {
			assertOwner(ownerId);
			const record = actions.get(actionId);
			return record?.ownerId === ownerId
				? structuredClone(record.action)
				: undefined;
		},

		async updateAction(actionId, ownerId, patch: ActionPatch) {
			assertOwner(ownerId);
			const record = actions.get(actionId);
			// No await between this check and the write: that is the compare-and-set.
			if (record?.ownerId !== ownerId || record.action.status !== 'pending') {
				return undefined;
			}
			record.action = {
				...record.action,
				status: patch.status,
				...(patch.result === undefined
					? {}
					: { result: structuredClone(patch.result) }),
			};
			return structuredClone(record.action);
		},

		async deleteThread(id, ownerId) {
			const record = own(id, ownerId);
			if (!record) return false;
			threads.delete(id);
			for (const [actionId, a] of actions) {
				if (a.threadId === id) actions.delete(actionId);
			}
			return true;
		},
	};
}
