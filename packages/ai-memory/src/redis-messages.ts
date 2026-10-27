import type { Message } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import { proposedIn } from './redis-actions';
import {
	assertOwner,
	type Ctx,
	evalLua,
	keys,
	notFound,
	ownThread,
} from './redis-ctx';
import { type MessageMember, toStoredMessage, toThread } from './redis-map';
import { APPEND, SET_SUMMARY } from './redis-scripts';
import { messageSchema } from './schemas';
import type {
	LoadedThread,
	LoadOptions,
	StoredMessage,
	SummaryInput,
	ThreadSummary,
} from './types';

/** The four keys a thread owns besides its hash, in the order scripts take them. */
const threadKeys = (c: Ctx, id: string) => [
	keys.thread(c, id),
	keys.messages(c, id),
	keys.ids(c, id),
	keys.actionIndex(c, id),
];

export async function append(
	c: Ctx,
	threadId: string,
	ownerId: string,
	list: readonly Message[],
): Promise<StoredMessage[]> {
	assertOwner(ownerId);
	// Parsing strips unknown keys; schemas.types.spec.ts guards the cast.
	const parsed = list.map((m) => messageSchema.parse(m) as Message);
	if (parsed.length === 0) {
		if (!(await ownThread(c, threadId, ownerId))) throw notFound(threadId);
		return [];
	}
	const at = c.now();
	const actions = proposedIn(parsed);
	const members: MessageMember[] = parsed.map((message) => ({
		id: Bun.randomUUIDv7(),
		message,
		createdAt: at,
	}));
	const args = members.flatMap((m, i) => [
		m.id,
		JSON.stringify(m),
		String(actions[i]?.length ?? 0),
		...(actions[i] ?? []).flatMap((a) => [a.id, JSON.stringify(a)]),
	]);
	// The script reserves the seq range and writes in one step.
	const first = await evalLua(c, APPEND, threadKeys(c, threadId), [
		ownerId,
		String(at),
		c.expireAt(at),
		keys.actionPrefix(c, ownerId),
		String(parsed.length),
		...args,
	]);
	if (typeof first !== 'number') throw notFound(threadId);
	return members.map((m, i) => toStoredMessage(threadId, first + i, m));
}

export async function load(
	c: Ctx,
	threadId: string,
	ownerId: string,
	opts: LoadOptions,
): Promise<LoadedThread | undefined> {
	const hash = await ownThread(c, threadId, ownerId);
	if (!hash) return undefined;
	const thread = toThread(threadId, hash);
	let after = 0;
	if (opts.sinceSummary && thread.summary) {
		const seq = await c.redis.send('HGET', [
			keys.ids(c, threadId),
			thread.summary.throughMessageId,
		]);
		after = seq === null ? 0 : Number(seq);
	}
	// Seqs are gapless, so the members after `after` are seq `after + 1`, …
	const members = (await c.redis.send('ZRANGEBYSCORE', [
		keys.messages(c, threadId),
		`(${after}`,
		'+inf',
	])) as string[];
	return {
		thread,
		...(thread.summary ? { summary: thread.summary } : {}),
		messages: members.map((raw, i) =>
			toStoredMessage(
				threadId,
				after + i + 1,
				JSON.parse(raw) as MessageMember,
			),
		),
	};
}

export async function setSummary(
	c: Ctx,
	threadId: string,
	ownerId: string,
	input: SummaryInput,
): Promise<ThreadSummary> {
	if (!(await ownThread(c, threadId, ownerId))) throw notFound(threadId);
	const known = await c.redis.send('HEXISTS', [
		keys.ids(c, threadId),
		input.throughMessageId,
	]);
	if (!known) {
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
	const done = await evalLua(c, SET_SUMMARY, threadKeys(c, threadId), [
		ownerId,
		JSON.stringify(summary),
		String(at),
		c.expireAt(at),
	]);
	if (done === null || done === undefined) throw notFound(threadId);
	return summary;
}
