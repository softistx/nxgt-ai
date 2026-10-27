import type { ModelEvent } from '@nxgt/ai-core';
import { AnthropicError } from './errors';
import type { WireUsage } from './response';

export interface ToolBlock {
	id: string;
	name: string;
	json: string;
}

/** `stop_reason`s where the model ran out of room, so a cut tool input is expected. */
const CUT_OFF = new Set(['max_tokens', 'model_context_window_exceeded']);

export const wasCutOff = (stop: string | null | undefined): boolean =>
	CUT_OFF.has(stop ?? '');

/**
 * A finished tool block as a `tool-call` event, or the error its input
 * deserves. The caller holds the error until `message_stop`, because a block
 * cut by `max_tokens` is dropped rather than failed.
 */
export function toolCall(
	tool: ToolBlock,
	status: number,
): ModelEvent | AnthropicError {
	try {
		return {
			type: 'tool-call',
			id: tool.id,
			name: tool.name,
			input: tool.json === '' ? {} : (JSON.parse(tool.json) as unknown),
		};
	} catch (cause) {
		return new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: `Anthropic streamed invalid JSON input for tool ${tool.name}`,
			status,
			cause,
		});
	}
}

/** `message_delta` usage is cumulative and may carry only some fields. */
export function mergeWireUsage(start: WireUsage, delta: WireUsage): WireUsage {
	const out = { ...start };
	for (const key of Object.keys(delta) as (keyof WireUsage)[]) {
		const value = delta[key];
		if (value !== undefined) out[key] = value;
	}
	return out;
}
