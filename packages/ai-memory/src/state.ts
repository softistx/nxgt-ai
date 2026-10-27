import type { ProposedAction } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import type { StoredMessage, Thread } from './types';

export interface ThreadRecord {
	thread: Thread;
	/** Creation order across the store; the list cursor. */
	order: number;
	messages: StoredMessage[];
}

export interface ActionRecord {
	ownerId: string;
	threadId: string;
	action: ProposedAction;
}

/** What the store keeps; the functions of the sibling files change it. */
export interface State {
	now: () => number;
	threads: Map<string, ThreadRecord>;
	/** Keyed by `actionKey`, so an id is only ever taken within one owner. */
	actions: Map<string, ActionRecord>;
	counter: number;
}

export function assertOwner(ownerId: string): void {
	if (typeof ownerId !== 'string' || ownerId === '') {
		throw new MemoryError(
			'INVALID_OWNER',
			'ownerId must be a non-empty string.',
		);
	}
}

export const actionKey = (ownerId: string, actionId: string): string =>
	`${ownerId}\u0000${actionId}`;

/** The owner's thread, or undefined for an absent or foreign one. */
export function own(
	s: State,
	id: string,
	ownerId: string,
): ThreadRecord | undefined {
	assertOwner(ownerId);
	const record = s.threads.get(id);
	return record?.thread.ownerId === ownerId ? record : undefined;
}

export function ownOrThrow(
	s: State,
	id: string,
	ownerId: string,
): ThreadRecord {
	const record = own(s, id, ownerId);
	if (!record) {
		throw new MemoryError('THREAD_NOT_FOUND', `Thread "${id}" was not found.`);
	}
	return record;
}
