import type { ProposedActionStatus, ToolResultPart } from '@nxgt/ai-core';
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

/**
 * The result a store keeps, or `undefined` when the patch has none. An error
 * result keeps its code only: the message and the issues are dropped (the
 * `message` stays as an empty string, the field being required), because apps
 * may expose a stored `result` to clients. The single point where the three
 * stores write an outcome.
 */
export function storedResult(patch: ActionPatch): ToolResultPart | undefined {
	const result = patch.result;
	if (result === undefined) return undefined;
	if (!result.isError) return structuredClone(result);
	return {
		type: 'tool-result',
		callId: result.callId,
		name: result.name,
		isError: true,
		error: { code: result.error.code, message: '' },
	};
}
