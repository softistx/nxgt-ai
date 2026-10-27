import {
	type Message,
	type ProposedAction,
	toProposedAction,
} from '@nxgt/ai-core';
import { assertOwner, type Ctx, evalLua, keys } from './redis-ctx';
import { parseAction } from './redis-map';
import { UPDATE_ACTION } from './redis-scripts';
import type { ActionPatch } from './types';

/** Per message, the actions it proposes, once each within the batch. */
export function proposedIn(list: readonly Message[]): ProposedAction[][] {
	const seen = new Set<string>();
	return list.map((message) => {
		const fresh: ProposedAction[] = [];
		for (const part of message.parts) {
			if (part.type !== 'proposed-action' || seen.has(part.id)) continue;
			seen.add(part.id);
			fresh.push(toProposedAction(part));
		}
		return fresh;
	});
}

export async function findAction(
	c: Ctx,
	actionId: string,
	ownerId: string,
): Promise<ProposedAction | undefined> {
	assertOwner(ownerId);
	const key = `${keys.actionPrefix(c, ownerId)}${actionId}`;
	const [body, status, result] = (await c.redis.send('HMGET', [
		key,
		'body',
		'status',
		'result',
	])) as (string | null)[];
	const action = parseAction(body);
	if (!action || status === null) return undefined;
	return {
		...action,
		status,
		...(result === null ? {} : { result: JSON.parse(result as string) }),
	} as ProposedAction;
}

export async function updateAction(
	c: Ctx,
	actionId: string,
	ownerId: string,
	patch: ActionPatch,
) {
	assertOwner(ownerId);
	// One script: it matches only while the action is still pending.
	const done = await evalLua(
		c,
		UPDATE_ACTION,
		[`${keys.actionPrefix(c, ownerId)}${actionId}`],
		[
			patch.status,
			patch.result === undefined ? '0' : '1',
			patch.result === undefined ? '' : JSON.stringify(patch.result),
		],
	);
	return done === null || done === undefined
		? undefined
		: findAction(c, actionId, ownerId);
}
