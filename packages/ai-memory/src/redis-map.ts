import type { Message, ProposedAction } from '@nxgt/ai-core';
import type { StoredMessage, Thread, ThreadSummary } from './types';

/** A thread hash as the application reads it. */
export function toThread(id: string, hash: Record<string, string>): Thread {
	return {
		id,
		ownerId: hash['ownerId'] as string,
		...(hash['title'] === undefined ? {} : { title: hash['title'] }),
		...(hash['meta'] === undefined ? {} : { meta: JSON.parse(hash['meta']) }),
		messageCount: Number(hash['messageCount']),
		...(hash['summary'] === undefined
			? {}
			: { summary: JSON.parse(hash['summary']) as ThreadSummary }),
		createdAt: Number(hash['createdAt']),
		updatedAt: Number(hash['updatedAt']),
	};
}

/** What a sorted-set member holds; the seq is its position, not stored. */
export interface MessageMember {
	id: string;
	message: Message;
	createdAt: number;
}

export function toStoredMessage(
	threadId: string,
	seq: number,
	member: MessageMember,
): StoredMessage {
	return {
		id: member.id,
		threadId,
		seq,
		message: member.message,
		createdAt: member.createdAt,
	};
}

export function parseAction(raw: unknown): ProposedAction | undefined {
	return typeof raw === 'string'
		? (JSON.parse(raw) as ProposedAction)
		: undefined;
}
