import type { FinishReason, ModelEvent, Usage } from '@nxgt/ai-core';

export interface WireUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface WireResponse {
	content?: Array<{
		type: string;
		text?: string;
		thinking?: string;
		signature?: string;
		data?: string;
		id?: string;
		name?: string;
		input?: unknown;
	}>;
	stop_reason?: string | null;
	usage?: WireUsage;
}

export const FINISH: Record<string, FinishReason> = {
	end_turn: 'end',
	stop_sequence: 'end',
	tool_use: 'tool-use',
	max_tokens: 'max-tokens',
	refusal: 'refusal',
	// The server-tool loop paused: the caller may resend the turn to continue.
	pause_turn: 'end',
	model_context_window_exceeded: 'max-tokens',
};

/**
 * Anthropic's `input_tokens` leaves out the cache; `Usage.inputTokens` is all
 * input, so the cache read and write tokens are added to it.
 */
export function toUsage(wire: WireUsage): Usage {
	return {
		inputTokens:
			(wire.input_tokens ?? 0) +
			(wire.cache_read_input_tokens ?? 0) +
			(wire.cache_creation_input_tokens ?? 0),
		outputTokens: wire.output_tokens ?? 0,
		cacheReadTokens: wire.cache_read_input_tokens ?? 0,
		cacheWriteTokens: wire.cache_creation_input_tokens ?? 0,
	};
}

/**
 * The events of one complete (non-streamed) response, for a gateway that
 * answers `stream: true` with plain JSON.
 */
export function* eventsFromMessage(body: WireResponse): Generator<ModelEvent> {
	for (const block of body.content ?? []) {
		if (block.type === 'text' && block.text)
			yield { type: 'text-delta', text: block.text, start: true };
		else if (block.type === 'thinking' && block.signature !== undefined)
			yield {
				type: 'thinking-delta',
				start: true,
				text: block.thinking ?? '',
				signature: block.signature,
			};
		else if (block.type === 'redacted_thinking')
			yield { type: 'thinking-delta', text: '', redacted: block.data ?? '' };
		else if (block.type === 'tool_use')
			yield {
				type: 'tool-call',
				id: block.id ?? '',
				name: block.name ?? '',
				input: block.input ?? {},
			};
	}
	if (body.usage) yield { type: 'usage', usage: toUsage(body.usage) };
	yield { type: 'finish', reason: FINISH[body.stop_reason ?? ''] ?? 'end' };
}
