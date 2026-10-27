import { AiError } from './errors';
import { executeTool } from './execute-tool';
import type { ProposedActionPart, ToolResultPart } from './message';
import type { AnyTool } from './tool';

/** How long a proposed action can be confirmed unless the run says otherwise. */
export const DEFAULT_PROPOSAL_TTL_MS = 60 * 60 * 1000;

export type ProposedActionStatus =
	| 'pending'
	| 'confirmed'
	| 'rejected'
	| 'expired'
	| 'failed';

/**
 * A mutation the model asked for and nobody has confirmed yet. Store it,
 * show it to the user, then call `runConfirmedAction` or `rejectAction`.
 */
export interface ProposedAction {
	id: string;
	tool: string;
	/** What the model sent; validated again when the action is confirmed. */
	input: unknown;
	status: ProposedActionStatus;
	/** Epoch milliseconds. */
	expiresAt: number;
	/** Set once the tool ran: its output, or its error when `failed`. */
	result?: ToolResultPart;
	summary?: string;
}

/** The pending action a `proposed-action` part records. */
export function toProposedAction(part: ProposedActionPart): ProposedAction {
	return {
		id: part.id,
		tool: part.tool,
		input: part.input,
		status: 'pending',
		expiresAt: part.expiresAt,
		...(part.summary === undefined ? {} : { summary: part.summary }),
	};
}

function assertPending(action: ProposedAction, now: number): void {
	if (action.status !== 'pending') {
		throw new AiError(
			'ACTION_NOT_PENDING',
			`Action "${action.id}" is ${action.status}, not pending.`,
		);
	}
	if (now >= action.expiresAt) {
		throw new AiError('ACTION_EXPIRED', `Action "${action.id}" has expired.`);
	}
}

export interface ConfirmOptions {
	/** The clock, in epoch ms; default `Date.now`. */
	now?: () => number;
}

export interface ConfirmContext {
	/** Passed to the tool as `ToolContext.context`. */
	context?: unknown;
	signal?: AbortSignal;
}

/**
 * Runs a pending action's tool, once. It re-validates the input and refuses,
 * before running anything, an action that is not `pending` (`ACTION_NOT_PENDING`),
 * has expired (`ACTION_EXPIRED`), names an unknown tool (`UNKNOWN_TOOL`) or has
 * invalid input (`INVALID_TOOL_INPUT`). It returns a new action, `confirmed`
 * with the tool's result or `failed` when the tool threw; the caller stores it,
 * which is what keeps a second confirmation out. An abort rejects and leaves
 * the action to the caller.
 */
export async function runConfirmedAction(
	action: ProposedAction,
	tools: readonly AnyTool[],
	ctx: ConfirmContext = {},
	options: ConfirmOptions = {},
): Promise<ProposedAction> {
	assertPending(action, (options.now ?? Date.now)());
	const tool = tools.find((t) => t.name === action.tool);
	if (!tool) {
		throw new AiError('UNKNOWN_TOOL', `No tool named "${action.tool}".`);
	}
	const validation = tool.validate(action.input);
	if (!validation.ok) {
		throw new AiError(
			'INVALID_TOOL_INPUT',
			`Invalid input for tool "${tool.name}": ${validation.issues.map((i) => i.message).join('; ')}`,
			{ issues: validation.issues },
		);
	}
	const result = await executeTool(
		tool,
		{ type: 'tool-call', id: action.id, name: tool.name, input: action.input },
		ctx,
	);
	return { ...action, status: result.isError ? 'failed' : 'confirmed', result };
}

/** Marks a pending action `rejected`; nothing runs. */
export function rejectAction(
	action: ProposedAction,
	options: ConfirmOptions = {},
): ProposedAction {
	assertPending(action, (options.now ?? Date.now)());
	return { ...action, status: 'rejected' };
}
