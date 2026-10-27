import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { assertOwner, type Ctx } from './mongo-ctx';
import { pickAction } from './mongo-map';
import type { ActionPatch } from './types';

/** Per message, the actions it proposes that this owner has not recorded yet. */
export async function newActions(
	c: Ctx,
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
			const known = await c.messages.findOne({
				ownerId,
				'actions.id': part.id,
			});
			if (!known) fresh.push(toProposedAction(part));
		}
		result.push(fresh);
	}
	return result;
}

export async function findAction(c: Ctx, actionId: string, ownerId: string) {
	assertOwner(ownerId);
	const doc = await c.messages.findOne({ ownerId, 'actions.id': actionId });
	return pickAction(doc, actionId);
}

export async function updateAction(
	c: Ctx,
	actionId: string,
	ownerId: string,
	patch: ActionPatch,
) {
	assertOwner(ownerId);
	// One atomic write: it matches only while the action is still pending.
	const doc = await c.messages.findOneAndUpdate(
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
