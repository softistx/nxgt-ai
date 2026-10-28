import type { AgentObserver } from './agent-types';
import { AiError } from './errors';
import type { AgentEvent } from './events';
import { executeTool } from './execute-tool';
import {
	errorResult,
	type ProposedActionPart,
	type ToolCallPart,
	type ToolResultPart,
} from './message';
import { notify } from './observers';
import type { AnyTool } from './tool';

export interface ToolRunContext {
	tools: ReadonlyMap<string, AnyTool>;
	context: unknown;
	signal: AbortSignal;
	step: number;
	runId: string;
	/** How long a proposal can be confirmed, in ms. */
	ttlMs: number;
	now(): number;
	/** Receives the proposed-action parts, to record them in the tool message. */
	proposals: ProposedActionPart[];
	observers: readonly AgentObserver[] | undefined;
	emit(event: AgentEvent): void;
}

/**
 * A confirm-gated tool is never run by the loop: a valid call is recorded as
 * a pending proposed action and the model is told so.
 */
function propose(
	tool: AnyTool,
	call: ToolCallPart,
	run: ToolRunContext,
): ToolResultPart {
	const validation = tool.validate(call.input);
	if (!validation.ok) {
		return errorResult(
			call,
			new AiError(
				'INVALID_TOOL_INPUT',
				`Invalid input for tool "${tool.name}": ${validation.issues
					.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
					.join('; ')}`,
				{ issues: validation.issues },
			),
		);
	}
	const action: ProposedActionPart = {
		type: 'proposed-action',
		id: call.id,
		tool: tool.name,
		input: call.input,
		expiresAt: run.now() + run.ttlMs,
	};
	run.proposals.push(action);
	run.emit({ type: 'proposed-action', action });
	return {
		type: 'tool-result',
		callId: call.id,
		name: tool.name,
		isError: false,
		output: { status: 'pending', actionId: action.id },
	};
}

function abortedResult(call: ToolCallPart): ToolResultPart {
	return errorResult(
		call,
		new AiError('ABORTED', `Tool "${call.name}" was aborted.`),
	);
}

/**
 * Resolves with an `ABORTED` result as soon as the signal aborts, so a tool
 * that ignores its signal is no longer waited for. `release` removes the
 * listener once the call has settled.
 */
function whenAborted(
	call: ToolCallPart,
	signal: AbortSignal,
): { aborted: Promise<ToolResultPart>; release(): void } {
	let release = () => {};
	const aborted = new Promise<ToolResultPart>((resolve) => {
		const onAbort = () => resolve(abortedResult(call));
		if (signal.aborted) return onAbort();
		signal.addEventListener('abort', onAbort, { once: true });
		release = () => signal.removeEventListener('abort', onAbort);
	});
	return { aborted, release: () => release() };
}

async function runOne(
	call: ToolCallPart,
	run: ToolRunContext,
): Promise<ToolResultPart> {
	const tool = run.tools.get(call.name);
	if (!tool) {
		return errorResult(
			call,
			new AiError('UNKNOWN_TOOL', `No tool named "${call.name}".`),
		);
	}
	if (tool.confirm) return propose(tool, call, run);
	try {
		return await executeTool(tool, call, {
			context: run.context,
			signal: run.signal,
		});
	} catch (error) {
		const aborted = run.signal.aborted;
		return errorResult(
			call,
			new AiError(
				aborted ? 'ABORTED' : 'TOOL_FAILED',
				aborted
					? `Tool "${call.name}" was aborted.`
					: `Tool "${call.name}" failed.`,
				{ cause: error },
			),
		);
	}
}

/**
 * Runs the calls in parallel and returns their results in call order. Each
 * `tool-result` event is emitted as its tool finishes. Never rejects: after
 * an abort, a tool still running answers with an `ABORTED` result at once,
 * even when it ignores its signal; it is not waited for and whatever it
 * returns later is dropped.
 */
export function runToolCalls(
	calls: readonly ToolCallPart[],
	run: ToolRunContext,
): Promise<ToolResultPart[]> {
	return Promise.all(
		calls.map(async (call) => {
			await notify(run.observers, 'onToolStart', {
				runId: run.runId,
				step: run.step,
				call,
			});
			const started = performance.now();
			// Aborted while the observers ran: neither run nor propose the call.
			const guard = whenAborted(call, run.signal);
			const result = run.signal.aborted
				? abortedResult(call)
				: await Promise.race([runOne(call, run), guard.aborted]);
			guard.release();
			run.emit({ type: 'tool-result', result });
			await notify(run.observers, 'onToolCall', {
				runId: run.runId,
				step: run.step,
				call,
				result,
				durationMs: performance.now() - started,
			});
			return result;
		}),
	);
}
