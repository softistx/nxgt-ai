import type { FinishReason, ModelEvent } from '@nxgt/ai-core';
import { OllamaError, streamError } from './errors';
import { parseNdjson } from './ndjson';

interface Chunk {
	message?: {
		content?: string;
		thinking?: string;
		tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
	};
	done?: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
	error?: string;
}

function finishReason(chunk: Chunk, sawToolCall: boolean): FinishReason {
	if (sawToolCall) return 'tool-use';
	return chunk.done_reason === 'length' ? 'max-tokens' : 'end';
}

/** Ollama sends arguments as an object; a few versions send a JSON string. */
function parseArguments(value: unknown): unknown {
	if (typeof value !== 'string') return value ?? {};
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function* eventsOf(
	chunk: Chunk,
	newId: () => string,
): Generator<ModelEvent, boolean> {
	let sawToolCall = false;
	const m = chunk.message;
	if (m?.thinking) yield { type: 'thinking-delta', text: m.thinking };
	if (m?.content) yield { type: 'text-delta', text: m.content };
	for (const call of m?.tool_calls ?? []) {
		if (!call.function?.name) continue;
		sawToolCall = true;
		yield {
			type: 'tool-call',
			id: newId(),
			name: call.function.name,
			input: parseArguments(call.function.arguments),
		};
	}
	return sawToolCall;
}

/**
 * Turns an `/api/chat` NDJSON response into model events. Ollama sends whole
 * tool calls, so each gets an id here. Ends quietly when `signal` aborts.
 */
export async function* eventsFromStream(
	res: Response,
	signal: AbortSignal,
	newId: () => string,
): AsyncGenerator<ModelEvent> {
	if (res.body === null) return;
	let sawToolCall = false;
	try {
		for await (const value of parseNdjson(res.body, signal)) {
			if (signal.aborted) return;
			const chunk = value as Chunk;
			if (typeof chunk.error === 'string') throw streamError(chunk.error);
			sawToolCall = (yield* eventsOf(chunk, newId)) || sawToolCall;
			if (chunk.done) {
				yield {
					type: 'usage',
					usage: {
						inputTokens: chunk.prompt_eval_count ?? 0,
						outputTokens: chunk.eval_count ?? 0,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
					},
				};
				yield { type: 'finish', reason: finishReason(chunk, sawToolCall) };
				return;
			}
		}
	} catch (error) {
		if (signal.aborted) return;
		throw error;
	}
	if (signal.aborted) return;
	throw new OllamaError({
		kind: 'protocol',
		code: 'MODEL_ERROR',
		message: 'Ollama closed the stream before the final `done` line',
	});
}
