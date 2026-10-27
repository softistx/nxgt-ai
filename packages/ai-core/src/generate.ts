import { AiError } from './errors';
import {
	addUsage,
	emptyUsage,
	type Message,
	type Part,
	type Usage,
} from './message';
import type { FinishReason, ModelAdapter, ModelRequest } from './model';

export interface GenerateResult {
	/** The assistant message: thinking, text and tool-call parts in order. */
	message: Message;
	usage: Usage;
	finishReason: FinishReason;
}

const aborted = (cause?: unknown) =>
	new AiError('ABORTED', 'The model call was aborted', { cause });

/** Appends a delta to the last part when it has the same type. */
function pushDelta(
	parts: Part[],
	type: 'text' | 'thinking',
	text: string,
	signature?: string,
	redacted?: string,
) {
	if (redacted !== undefined) {
		// An opaque block stands alone: never merged with what comes before or after.
		parts.push({ type: 'thinking', text: '', redacted });
		return;
	}
	const last = parts[parts.length - 1];
	if (
		last?.type === type &&
		!(last.type === 'thinking' && last.redacted !== undefined)
	) {
		last.text += text;
		if (last.type === 'thinking' && signature) last.signature = signature;
		return;
	}
	parts.push(
		type === 'text'
			? { type, text }
			: { type, text, ...(signature ? { signature } : {}) },
	);
}

/**
 * Runs one model call and folds its events into an assistant message. Throws
 * `AiError` `ABORTED` when `signal` aborts, `MODEL_ERROR` when the stream ends
 * without a `finish`; an adapter's own `AiError` passes through.
 */
export async function generate(
	model: ModelAdapter,
	req: ModelRequest,
	signal: AbortSignal = new AbortController().signal,
): Promise<GenerateResult> {
	const parts: Part[] = [];
	let usage = emptyUsage();
	let finishReason: FinishReason | undefined;
	try {
		if (signal.aborted) throw aborted();
		for await (const event of model.stream(req, signal)) {
			if (signal.aborted) throw aborted();
			switch (event.type) {
				case 'text-delta':
					pushDelta(parts, 'text', event.text);
					break;
				case 'thinking-delta':
					pushDelta(
						parts,
						'thinking',
						event.text,
						event.signature,
						event.redacted,
					);
					break;
				case 'tool-call':
					parts.push({
						type: 'tool-call',
						id: event.id,
						name: event.name,
						input: event.input,
					});
					break;
				case 'usage':
					usage = addUsage(usage, event.usage);
					break;
				case 'finish':
					finishReason = event.reason;
					break;
			}
		}
	} catch (error) {
		if (error instanceof AiError && error.code === 'ABORTED') throw error;
		if (signal.aborted) throw aborted(error);
		throw error;
	}
	if (signal.aborted) throw aborted();
	if (finishReason === undefined) {
		throw new AiError('MODEL_ERROR', 'The model stream ended without a finish');
	}
	return { message: { role: 'assistant', parts }, usage, finishReason };
}
