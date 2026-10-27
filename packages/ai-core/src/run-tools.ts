import type { AgentObserver } from './agent-types';
import { AiError } from './errors';
import type { AgentEvent } from './events';
import { executeTool } from './execute-tool';
import { errorResult, type ToolCallPart, type ToolResultPart } from './message';
import { notify } from './observers';
import type { AnyTool } from './tool';

export interface ToolRunContext {
	tools: ReadonlyMap<string, AnyTool>;
	context: unknown;
	signal: AbortSignal;
	step: number;
	observers: readonly AgentObserver[] | undefined;
	emit(event: AgentEvent): void;
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
	if (tool.confirm) {
		// Temporary: confirm-gated tools become proposed actions in a later slice.
		return errorResult(
			call,
			new AiError(
				'TOOL_FAILED',
				`Tool "${call.name}" needs a confirmation and is not run by the agent loop.`,
			),
		);
	}
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
 * `tool-result` event is emitted as its tool finishes. Never rejects: a tool
 * cut short by an abort answers with an `ABORTED` result.
 */
export function runToolCalls(
	calls: readonly ToolCallPart[],
	run: ToolRunContext,
): Promise<ToolResultPart[]> {
	return Promise.all(
		calls.map(async (call) => {
			const started = performance.now();
			const result = await runOne(call, run);
			run.emit({ type: 'tool-result', result });
			await notify(run.observers, 'onToolCall', {
				step: run.step,
				call,
				result,
				durationMs: performance.now() - started,
			});
			return result;
		}),
	);
}
