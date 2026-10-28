import type { Message } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import { newActions } from './mongo-actions';
import type { MongoDoc } from './mongo-collection';
import {
	assertOwner,
	type Ctx,
	notFound,
	ownThread,
	scoped,
} from './mongo-ctx';
import { toStoredMessage, toThread } from './mongo-map';
import { messageSchema } from './schemas';
import type {
	LoadedThread,
	LoadOptions,
	StoredMessage,
	SummaryInput,
	ThreadSummary,
} from './types';

export async function append(
	c: Ctx,
	threadId: string,
	ownerId: string,
	list: readonly Message[],
): Promise<StoredMessage[]> {
	assertOwner(ownerId);
	// Parsing strips unknown keys; schemas.types.spec.ts guards the cast.
	const parsed = list.map((m) => messageSchema.parse(m) as Message);
	const at = c.now();
	// The $inc reserves the seq range, so concurrent appends never share one.
	const before = await c.threads.findOneAndUpdate(
		scoped(c, { _id: threadId, ownerId }),
		{
			$inc: { messageCount: parsed.length },
			$set: { updatedAt: at, ...c.expiry(at) },
		},
		{ returnDocument: 'before' },
	);
	if (!before) throw notFound(threadId);
	const first = (before['messageCount'] as number) + 1;
	const actions = await newActions(c, ownerId, parsed);
	const docs = parsed.map(
		(message, i): MongoDoc => ({
			_id: Bun.randomUUIDv7(),
			threadId,
			ownerId,
			seq: first + i,
			message,
			createdAt: at,
			...((actions[i]?.length ?? 0) > 0 ? { actions: actions[i] } : {}),
			...c.expiry(at),
			...c.scope,
		}),
	);
	if (docs.length > 0) {
		await c.messages.insertMany(docs);
		// A delete that ran meanwhile cannot see this batch: drop it.
		if (!(await ownThread(c, threadId, ownerId))) {
			await c.messages.deleteMany(scoped(c, { threadId, ownerId }));
			throw notFound(threadId);
		}
	}
	await slide(c, threadId, ownerId, at);
	return docs.map(toStoredMessage);
}

/**
 * A thread expires as one unit: every write moves all its messages to the
 * thread's `expiresAt`, so the oldest never expire first.
 */
async function slide(c: Ctx, threadId: string, ownerId: string, at: number) {
	const expiry = c.expiry(at);
	if (Object.keys(expiry).length === 0) return;
	await c.messages.updateMany(scoped(c, { threadId, ownerId }), {
		$set: expiry,
	});
}

export async function load(
	c: Ctx,
	threadId: string,
	ownerId: string,
	opts: LoadOptions,
): Promise<LoadedThread | undefined> {
	const doc = await ownThread(c, threadId, ownerId);
	if (!doc) return undefined;
	const thread = toThread(doc, c.scope);
	let after = 0;
	if (opts.sinceSummary && thread.summary) {
		const through = await c.messages.findOne(
			scoped(c, {
				_id: thread.summary.throughMessageId,
				threadId,
				ownerId,
			}),
		);
		after = (through?.['seq'] as number | undefined) ?? 0;
	}
	const docs = await c.messages
		.find(scoped(c, { threadId, ownerId, seq: { $gt: after } }))
		.sort({ seq: 1 })
		.toArray();
	return {
		thread,
		...(thread.summary ? { summary: thread.summary } : {}),
		messages: docs.map(toStoredMessage),
	};
}

export async function setSummary(
	c: Ctx,
	threadId: string,
	ownerId: string,
	input: SummaryInput,
): Promise<ThreadSummary> {
	if (!(await ownThread(c, threadId, ownerId))) throw notFound(threadId);
	const through = await c.messages.findOne(
		scoped(c, { _id: input.throughMessageId, threadId, ownerId }),
	);
	if (!through) {
		throw new MemoryError(
			'MESSAGE_NOT_FOUND',
			`Message "${input.throughMessageId}" is not in thread "${threadId}".`,
		);
	}
	const at = c.now();
	const summary: ThreadSummary = {
		text: input.text,
		throughMessageId: input.throughMessageId,
		tokens: input.tokens,
		createdAt: at,
	};
	const done = await c.threads.updateOne(
		scoped(c, { _id: threadId, ownerId }),
		{ $set: { summary, updatedAt: at, ...c.expiry(at) } },
	);
	if (done.matchedCount === 0) throw notFound(threadId);
	await slide(c, threadId, ownerId, at);
	return summary;
}
