import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { assertOwner, type Ctx, scoped } from './mongo-ctx';
import { pickAction } from './mongo-map';
import { actionFrom } from './transitions';
import type { ActionPatch, ActionUpdateOptions } from './types';

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
			const known = await c.messages.findOne(
				scoped(c, { ownerId, 'actions.id': part.id }),
			);
			if (!known) fresh.push(toProposedAction(part));
		}
		result.push(fresh);
	}
	return result;
}

export async function findAction(c: Ctx, actionId: string, ownerId: string) {
	assertOwner(ownerId);
	const doc = await c.messages.findOne(
		scoped(c, { ownerId, 'actions.id': actionId }),
	);
	return pickAction(doc, actionId);
}

export async function updateAction(
	c: Ctx,
	actionId: string,
	ownerId: string,
	patch: ActionPatch,
	options?: ActionUpdateOptions,
) {
	assertOwner(ownerId);
	const from = actionFrom(patch, options);
	// One atomic write: it matches only while the action still has a `from` status.
	const doc = await c.messages.findOneAndUpdate(
		scoped(c, {
			ownerId,
			actions: { $elemMatch: { id: actionId, status: { $in: from } } },
		}),
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
