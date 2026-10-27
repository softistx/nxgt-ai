import type { AgentEvent } from './events';
import type { Message, ToolCallPart, ToolResultPart } from './message';

/**
 * Tool calls on a step that did not end in `tool-use` never run. Each gets an
 * error result, so the history stays valid for a provider that wants every
 * call answered (Anthropic answers 400 to a `tool_use` with no `tool_result`).
 */
export function answerCutOff(
	calls: readonly ToolCallPart[],
	finish: string,
	state: { added: Message[] },
	emit: (event: AgentEvent) => void,
): void {
	const message = `The call was cut off (the step ended ${finish}) and did not run.`;
	const parts: ToolResultPart[] = calls.map((call) => ({
		type: 'tool-result',
		callId: call.id,
		name: call.name,
		isError: true,
		error: { code: 'MODEL_ERROR', message },
	}));
	for (const result of parts) emit({ type: 'tool-result', result });
	const toolMessage: Message = { role: 'tool', parts };
	state.added.push(toolMessage);
	emit({ type: 'message', message: toolMessage });
}
