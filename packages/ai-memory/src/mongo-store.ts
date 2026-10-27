import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { MemoryError } from './errors';
import type { MongoCollection, MongoDoc } from './mongo-collection';
import { pickAction, toStoredMessage, toThread } from './mongo-map';
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface MongoMemoryOptions {
	threads: MongoCollection;
	messages: MongoCollection;
	/**
	 * Documents expire this long after their last write (a thread) or their
	 * insert (a message); needs `expiresAtIndex` on both collections.
	 */
	expireAfterSeconds?: number;
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

function assertOwner(ownerId: string): void {
	if (typeof ownerId !== 'string' || ownerId === '') {
		throw new MemoryError(
			'INVALID_OWNER',
			'ownerId must be a non-empty string.',
		);
	}
}

const notFound = (id: string): MemoryError =>
	new MemoryError('THREAD_NOT_FOUND', `Thread "${id}" was not found.`);

/** A store over two MongoDB collections; see the guide for indexes and TTL. */
export function mongoMemory(options: MongoMemoryOptions): MemoryStore {
	const { threads, messages, expireAfterSeconds } = options;
	const now = options.now ?? Date.now;
	/** `{ expiresAt }` for a write at `at`, or nothing without a TTL. */
	const expiry = (at: number): MongoDoc =>
		expireAfterSeconds === undefined
			? {}
			: { expiresAt: new Date(at + expireAfterSeconds * 1000) };

	async function ownThread(id: string, ownerId: string) {
		assertOwner(ownerId);
		return threads.findOne({ _id: id, ownerId });
	}

	async function createThread(input: CreateThreadInput): Promise<Thread> {
		assertOwner(input.ownerId);
		const at = now();
		const doc: MongoDoc = {
			_id: Bun.randomUUIDv7(),
			ownerId: input.ownerId,
			...(input.title === undefined ? {} : { title: input.title }),
			...(input.meta === undefined ? {} : { meta: input.meta }),
			messageCount: 0,
			createdAt: at,
			updatedAt: at,
			...expiry(at),
		};
		await threads.insertOne(doc);
		return toThread(doc);
	}

	async function getThread(id: string, ownerId: string) {
		const doc = await ownThread(id, ownerId);
		return doc ? toThread(doc) : undefined;
	}

	async function listThreads(
		ownerId: string,
		page: Page = {},
	): Promise<ThreadPage> {
		assertOwner(ownerId);
		const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
		if (page.cursor !== undefined && !CURSOR.test(page.cursor)) {
			throw new MemoryError(
				'INVALID_CURSOR',
				`"${page.cursor}" is not a cursor this store gave.`,
			);
		}
		const docs = await threads
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

	/** The actions a message proposes that this owner has not recorded yet. */
	async function newActions(
		ownerId: string,
		list: readonly Message[],
	): Promise<ProposedAction[][]> {
		const seen = new Set<string>();
		const result: ProposedAction[][] = [];
		for (const message of list) {
			const fresh: ProposedAction[] = [];
			for (const part of message.parts) {
				if (part.type !== 'proposed-action' || seen.has(part.id)) continue;
				seen.add(part.id);
				const known = await messages.findOne({
					ownerId,
					'actions.id': part.id,
				});
				if (!known) fresh.push(toProposedAction(part));
			}
			result.push(fresh);
		}
		return result;
	}

	async function append(
		threadId: string,
		ownerId: string,
		list: readonly Message[],
	): Promise<StoredMessage[]> {
		assertOwner(ownerId);
		// Parsing strips unknown keys; schemas.types.spec.ts guards the cast.
		const parsed = list.map((m) => messageSchema.parse(m) as Message);
		const at = now();
		// The $inc reserves the seq range, so concurrent appends never share one.
		const before = await threads.findOneAndUpdate(
			{ _id: threadId, ownerId },
			{
				$inc: { messageCount: parsed.length },
				$set: { updatedAt: at, ...expiry(at) },
			},
			{ returnDocument: 'before' },
		);
		if (!before) throw notFound(threadId);
		const first = (before['messageCount'] as number) + 1;
		const actions = await newActions(ownerId, parsed);
		const docs = parsed.map(
			(message, i): MongoDoc => ({
				_id: Bun.randomUUIDv7(),
				threadId,
				ownerId,
				seq: first + i,
				message,
				createdAt: at,
				...((actions[i]?.length ?? 0) > 0 ? { actions: actions[i] } : {}),
				...expiry(at),
			}),
		);
		if (docs.length > 0) await messages.insertMany(docs);
		return docs.map(toStoredMessage);
	}

	async function load(
		threadId: string,
		ownerId: string,
		opts: LoadOptions,
	): Promise<LoadedThread | undefined> {
		const doc = await ownThread(threadId, ownerId);
		if (!doc) return undefined;
		const thread = toThread(doc);
		let after = 0;
		if (opts.sinceSummary && thread.summary) {
			const through = await messages.findOne({
				_id: thread.summary.throughMessageId,
				threadId,
				ownerId,
			});
			after = (through?.['seq'] as number | undefined) ?? 0;
		}
		const docs = await messages
			.find({ threadId, ownerId, seq: { $gt: after } })
			.sort({ seq: 1 })
			.toArray();
		return {
			thread,
			...(thread.summary ? { summary: thread.summary } : {}),
			messages: docs.map(toStoredMessage),
		};
	}

	async function setSummary(
		threadId: string,
		ownerId: string,
		input: SummaryInput,
	): Promise<ThreadSummary> {
		if (!(await ownThread(threadId, ownerId))) throw notFound(threadId);
		const through = await messages.findOne({
			_id: input.throughMessageId,
			threadId,
			ownerId,
		});
		if (!through) {
			throw new MemoryError(
				'MESSAGE_NOT_FOUND',
				`Message "${input.throughMessageId}" is not in thread "${threadId}".`,
			);
		}
		const at = now();
		const summary: ThreadSummary = {
			text: input.text,
			throughMessageId: input.throughMessageId,
			tokens: input.tokens,
			createdAt: at,
		};
		const done = await threads.updateOne(
			{ _id: threadId, ownerId },
			{ $set: { summary, updatedAt: at, ...expiry(at) } },
		);
		if (done.matchedCount === 0) throw notFound(threadId);
		return summary;
	}

	async function findAction(actionId: string, ownerId: string) {
		assertOwner(ownerId);
		const doc = await messages.findOne({ ownerId, 'actions.id': actionId });
		return pickAction(doc, actionId);
	}

	async function updateAction(
		actionId: string,
		ownerId: string,
		patch: ActionPatch,
	) {
		assertOwner(ownerId);
		// One atomic write: it matches only while the action is still pending.
		const doc = await messages.findOneAndUpdate(
			{ ownerId, actions: { $elemMatch: { id: actionId, status: 'pending' } } },
			{
				$set: {
					'actions.$.status': patch.status,
					...(patch.result === undefined
						? {}
						: { 'actions.$.result': patch.result }),
				},
			},
			{ returnDocument: 'after' },
		);
		return pickAction(doc, actionId);
	}

	async function deleteThread(id: string, ownerId: string) {
		assertOwner(ownerId);
		const done = await threads.deleteOne({ _id: id, ownerId });
		if (done.deletedCount === 0) return false;
		await messages.deleteMany({ threadId: id, ownerId });
		return true;
	}

	return {
		createThread,
		getThread,
		listThreads,
		append,
		load,
		setSummary,
		findAction,
		updateAction,
		deleteThread,
	};
}
