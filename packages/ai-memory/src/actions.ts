import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { actionKey, assertOwner, type State, type ThreadRecord } from './state';
import { actionFrom, storedResult } from './transitions';
import type { ActionPatch, ActionUpdateOptions } from './types';

/** Records the pending actions a message proposes. */
export function keepActions(
	s: State,
	record: ThreadRecord,
	message: Message,
): void {
	const ownerId = record.thread.ownerId;
	for (const part of message.parts) {
		if (part.type !== 'proposed-action') continue;
		const key = actionKey(ownerId, part.id);
		if (s.actions.has(key)) continue;
		s.actions.set(key, {
			ownerId,
			threadId: record.thread.id,
			action: toProposedAction(part),
		});
	}
}

export function findAction(
	s: State,
	actionId: string,
	ownerId: string,
): ProposedAction | undefined {
	assertOwner(ownerId);
	const record = s.actions.get(actionKey(ownerId, actionId));
	return record && structuredClone(record.action);
}

export function updateAction(
	s: State,
	actionId: string,
	ownerId: string,
	patch: ActionPatch,
	options?: ActionUpdateOptions,
): ProposedAction | undefined {
	assertOwner(ownerId);
	const from = actionFrom(patch, options);
	const result = storedResult(patch);
	const record = s.actions.get(actionKey(ownerId, actionId));
	// Synchronous from this check to the write: that is the compare-and-set.
	if (!record || !from.includes(record.action.status)) return undefined;
	record.action = {
		...record.action,
		status: patch.status,
		...(result === undefined ? {} : { result }),
	};
	return structuredClone(record.action);
}

export function dropActions(s: State, threadId: string): void {
	for (const [key, a] of s.actions) {
		if (a.threadId === threadId) s.actions.delete(key);
	}
}
