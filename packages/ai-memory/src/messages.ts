import type { Message } from '@nxgt/ai-core';
import { keepActions } from './actions';
import { MemoryError } from './errors';
import { messageSchema } from './schemas';
import { own, ownOrThrow, type State } from './state';
import type {
	LoadedThread,
	LoadOptions,
	StoredMessage,
	SummaryInput,
	ThreadSummary,
} from './types';

export function append(
	s: State,
	threadId: string,
	ownerId: string,
	messages: readonly Message[],
): StoredMessage[] {
	const record = ownOrThrow(s, threadId, ownerId);
	// Parsing strips unknown keys; schemas.types.spec.ts guards the cast.
	const parsed = messages.map((m) => messageSchema.parse(m) as Message);
	const at = s.now();
	const stored = parsed.map(
		(message, i): StoredMessage => ({
			id: crypto.randomUUID(),
			threadId,
			seq: record.messages.length + i + 1,
			message: structuredClone(message),
			createdAt: at,
		}),
	);
	for (const m of stored) {
		record.messages.push(m);
		keepActions(s, record, m.message);
	}
	record.thread.messageCount = record.messages.length;
	record.thread.updatedAt = at;
	return structuredClone(stored);
}

export function load(
	s: State,
	threadId: string,
	ownerId: string,
	options: LoadOptions,
): LoadedThread | undefined {
	const record = own(s, threadId, ownerId);
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
}

export function setSummary(
	s: State,
	threadId: string,
	ownerId: string,
	input: SummaryInput,
): ThreadSummary {
	const record = ownOrThrow(s, threadId, ownerId);
	if (!record.messages.some((m) => m.id === input.throughMessageId)) {
		throw new MemoryError(
			'MESSAGE_NOT_FOUND',
			`Message "${input.throughMessageId}" is not in thread "${threadId}".`,
		);
	}
	const at = s.now();
	record.thread.summary = { ...input, createdAt: at };
	record.thread.updatedAt = at;
	return structuredClone(record.thread.summary);
}
