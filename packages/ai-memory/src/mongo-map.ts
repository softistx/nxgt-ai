import type { ProposedAction } from '@nxgt/ai-core';
import type { MongoDoc } from './mongo-collection';
import type { StoredMessage, Thread } from './types';

/** A thread document as the application reads it: no storage-only field. */
export function toThread(doc: MongoDoc): Thread {
	const { _id, expiresAt: _expiresAt, ...rest } = doc;
	return { id: _id, ...rest } as Thread;
}

export function toStoredMessage(doc: MongoDoc): StoredMessage {
	return {
		id: doc['_id'],
		threadId: doc['threadId'],
		seq: doc['seq'],
		message: doc['message'],
		createdAt: doc['createdAt'],
	} as StoredMessage;
}

export function pickAction(
	doc: MongoDoc | null,
	actionId: string,
): ProposedAction | undefined {
	const list = (doc?.['actions'] ?? []) as ProposedAction[];
	return list.find((a) => a.id === actionId);
}
