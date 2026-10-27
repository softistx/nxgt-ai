import type { FinishReason, ModelEvent, Usage } from '@nxgt/ai-core';

interface WireUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface WireResponse {
	content?: Array<{
		type: string;
		text?: string;
		id?: string;
		name?: string;
		input?: unknown;
	}>;
	stop_reason?: string | null;
	usage?: WireUsage;
}

const FINISH: Record<string, FinishReason> = {
	end_turn: 'end',
	stop_sequence: 'end',
	tool_use: 'tool-use',
	max_tokens: 'max-tokens',
	refusal: 'refusal',
};

export function toUsage(wire: WireUsage): Usage {
	return {
		inputTokens: wire.input_tokens ?? 0,
		outputTokens: wire.output_tokens ?? 0,
		cacheReadTokens: wire.cache_read_input_tokens ?? 0,
		cacheWriteTokens: wire.cache_creation_input_tokens ?? 0,
	};
}

/**
 * The events of one complete (non-streamed) response. S6b replaces this
 * with the SSE parser behind the same `ModelEvent` output.
 */
export function* eventsFromMessage(body: WireResponse): Generator<ModelEvent> {
	for (const block of body.content ?? []) {
		if (block.type === 'text' && block.text)
			yield { type: 'text-delta', text: block.text };
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
