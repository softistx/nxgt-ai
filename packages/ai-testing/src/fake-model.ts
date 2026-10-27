import {
	AiError,
	type FinishReason,
	type ModelAdapter,
	type ModelEvent,
	type ModelRequest,
	type Usage,
} from '@nxgt/ai-core';

/** One scripted model call. */
export interface Turn {
	text?: string;
	thinking?: string;
	/** Emitted as `tool-call` events with ids `call_<turn>_<index>`. */
	toolCalls?: { name: string; input: unknown }[];
	usage?: Usage;
	/** Default: `'tool-use'` with tool calls, else `'end'`. */
	finish?: FinishReason;
	/** Thrown by `stream` after the delay, before any event. */
	error?: AiError;
	/** Splits `text` and `thinking` into deltas of this many characters. */
	chunk?: number;
	/** Waits this long before the turn; an abort during it ends the stream. */
	delayMs?: number;
}

export type Script =
	| readonly Turn[]
	| ((req: ModelRequest, index: number) => Turn);

export interface FakeModel extends ModelAdapter {
	/** Every request `stream` received, in order. */
	readonly requests: ModelRequest[];
}

function split(text: string, size?: number): string[] {
	if (!size || size < 1 || text.length <= size) return text ? [text] : [];
	const out: string[] = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out;
}

/** Resolves `true` after `ms`, `false` when `signal` aborts first. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise((resolve) => {
		const onAbort = () => {
			clearTimeout(timer);
			resolve(false);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve(true);
		}, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function* events(turn: Turn, index: number): Generator<ModelEvent> {
	for (const text of split(turn.thinking ?? '', turn.chunk)) {
		yield { type: 'thinking-delta', text };
	}
	for (const text of split(turn.text ?? '', turn.chunk)) {
		yield { type: 'text-delta', text };
	}
	for (const [i, call] of (turn.toolCalls ?? []).entries()) {
		yield { type: 'tool-call', id: `call_${index}_${i}`, ...call };
	}
	if (turn.usage) yield { type: 'usage', usage: turn.usage };
	yield {
		type: 'finish',
		reason: turn.finish ?? (turn.toolCalls?.length ? 'tool-use' : 'end'),
	};
}

/**
 * A `ModelAdapter` that plays a script: turn `i` answers call `i`. The same
 * script gives the same events. A call past the end of an array script throws
 * `AiError` `MODEL_ERROR`.
 */
export function fakeModel(script: Script): FakeModel {
	const requests: ModelRequest[] = [];
	return {
		provider: 'fake',
		model: 'fake-1',
		requests,
		async *stream(req, signal) {
			const index = requests.length;
			requests.push({ ...req, messages: [...req.messages] });
			const turn =
				typeof script === 'function' ? script(req, index) : script[index];
			if (!turn) {
				throw new AiError(
					'MODEL_ERROR',
					`fakeModel script has no turn ${index}`,
				);
			}
			if (turn.delayMs && !(await sleep(turn.delayMs, signal))) return;
			if (signal.aborted) return;
			if (turn.error) throw turn.error;
			for (const event of events(turn, index)) {
				if (signal.aborted) return;
				yield event;
			}
		},
	};
}
