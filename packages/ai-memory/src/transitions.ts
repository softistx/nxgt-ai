import type { ProposedActionStatus } from '@nxgt/ai-core';
import { MemoryError } from './errors';
import type { ActionPatch, ActionUpdateOptions } from './types';

/**
 * Where each status may go. `pending` also reaches `confirmed` and `failed`
 * directly: the flow that runs the action without claiming it first.
 */
const NEXT: Record<ProposedActionStatus, readonly ProposedActionStatus[]> = {
	pending: ['running', 'confirmed', 'failed', 'rejected', 'expired'],
	running: ['confirmed', 'failed'],
	confirmed: [],
	failed: [],
	rejected: [],
	expired: [],
};

/**
 * The statuses `updateAction` must match, after checking that each may move to
 * `patch.status`. Pure: the same rule for the three stores.
 */
export function actionFrom(
	patch: ActionPatch,
	options: ActionUpdateOptions | undefined,
): ProposedActionStatus[] {
	const given = options?.from ?? 'pending';
	const from = typeof given === 'string' ? [given] : [...new Set(given)];
	if (from.length === 0) {
		throw new MemoryError(
			'INVALID_ACTION_TRANSITION',
			'"from" must name at least one status.',
		);
	}
	for (const status of from) {
		if (!NEXT[status]?.includes(patch.status)) {
			throw new MemoryError(
				'INVALID_ACTION_TRANSITION',
				`An action cannot move from ${status} to ${patch.status}.`,
			);
		}
	}
	return from;
}
