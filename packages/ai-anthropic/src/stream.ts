import type { FinishReason, ModelEvent } from '@nxgt/ai-core';
import { AnthropicError, type AnthropicErrorKind } from './errors';
import { FINISH, toUsage, type WireUsage } from './response';
import { parseSse } from './sse';
import {
	mergeWireUsage,
	type ToolBlock,
	toolCall,
	wasCutOff,
} from './stream-tools';

interface Wire {
	message?: { usage?: WireUsage };
	index?: number;
	content_block?: {
		type?: string;
		id?: string;
		name?: string;
		text?: string;
		data?: string;
	};
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		signature?: string;
		partial_json?: string;
		stop_reason?: string | null;
	};
	usage?: WireUsage;
	error?: { type?: string; message?: string };
}

const ERROR_KINDS: Record<string, AnthropicErrorKind> = {
	authentication_error: 'auth',
	permission_error: 'auth',
	invalid_request_error: 'bad-request',
	not_found_error: 'bad-request',
	request_too_large: 'bad-request',
	rate_limit_error: 'rate-limited',
	overloaded_error: 'overloaded',
	api_error: 'provider',
};

function streamError(
	wire: Wire['error'],
	status: number,
	requestId: string | undefined,
): AnthropicError {
	const kind = ERROR_KINDS[wire?.type ?? ''] ?? 'provider';
	return new AnthropicError({
		kind,
		code:
			kind === 'auth'
				? 'AUTHENTICATION'
				: kind === 'rate-limited'
					? 'RATE_LIMITED'
					: 'MODEL_ERROR',
		message: `Anthropic stream error (${wire?.type ?? 'unknown'}): ${wire?.message ?? ''}`,
		status,
		...(requestId === undefined ? {} : { requestId }),
	});
}

/** `stop_reason` as a port reason; `pause_turn` means "resume", see the guide. */
export function finishReason(stop: string | null | undefined): FinishReason {
	return FINISH[stop ?? ''] ?? 'end';
}

interface State {
	tools: Map<number, ToolBlock>;
	/** The first tool input that did not parse, held until `message_stop`. */
	badTool: AnthropicError | undefined;
	/** A text or thinking block opened and has not sent a delta yet. */
	opened: boolean;
	usage: WireUsage;
	stop: string | null | undefined;
	done: boolean;
}

function parseWire(data: string, event: string, status: number): Wire {
	try {
		return JSON.parse(data) as Wire;
	} catch (cause) {
		throw new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: `Anthropic stream sent invalid JSON in a ${event} event`,
			status,
			cause,
		});
	}
}

function* blockStartEvents(wire: Wire, state: State): Generator<ModelEvent> {
	const block = wire.content_block;
	state.opened = block?.type === 'text' || block?.type === 'thinking';
	if (block?.type === 'tool_use')
		state.tools.set(wire.index ?? 0, {
			id: block.id ?? '',
			name: block.name ?? '',
			json: '',
		});
	else if (block?.type === 'text' && block.text) {
		state.opened = false;
		yield { type: 'text-delta', text: block.text, start: true };
	} else if (block?.type === 'redacted_thinking')
		yield { type: 'thinking-delta', text: '', redacted: block.data ?? '' };
}

function* blockDeltaEvents(wire: Wire, state: State): Generator<ModelEvent> {
	const d = wire.delta;
	const start = state.opened ? ({ start: true } as const) : {};
	if (d?.type === 'text_delta' && d.text) {
		state.opened = false;
		yield { type: 'text-delta', text: d.text, ...start };
	} else if (d?.type === 'thinking_delta') {
		state.opened = false;
		yield { type: 'thinking-delta', text: d.thinking ?? '', ...start };
	} else if (d?.type === 'signature_delta') {
		state.opened = false;
		yield {
			type: 'thinking-delta',
			text: '',
			signature: d.signature ?? '',
			...start,
		};
	} else if (d?.type === 'input_json_delta') {
		const tool = state.tools.get(wire.index ?? 0);
		if (tool) tool.json += d.partial_json ?? '';
	}
}

/**
 * A finished tool block: its call, or, when the input does not parse, the
 * error held until `message_stop`, where a `max_tokens` stop drops the block.
 */
function* finishTool(
	tool: ToolBlock,
	state: State,
	status: number,
): Generator<ModelEvent> {
	const out = toolCall(tool, status);
	if (out instanceof AnthropicError) state.badTool ??= out;
	else yield out;
}

function* wireEvents(
	type: string,
	wire: Wire,
	state: State,
	res: Response,
	requestId: string | undefined,
): Generator<ModelEvent> {
	if (type === 'error') throw streamError(wire.error, res.status, requestId);
	if (type === 'message_start' && wire.message?.usage)
		state.usage = { ...wire.message.usage };
	else if (type === 'content_block_start') yield* blockStartEvents(wire, state);
	else if (type === 'content_block_delta') yield* blockDeltaEvents(wire, state);
	else if (type === 'content_block_stop') {
		const tool = state.tools.get(wire.index ?? 0);
		if (tool) {
			state.tools.delete(wire.index ?? 0);
			yield* finishTool(tool, state, res.status);
		}
	} else if (type === 'message_delta') {
		if (wire.delta?.stop_reason !== undefined)
			state.stop = wire.delta.stop_reason;
		if (wire.usage) state.usage = mergeWireUsage(state.usage, wire.usage);
	} else if (type === 'message_stop') {
		state.done = true;
		// A block whose content_block_stop never came is judged like the others.
		for (const tool of state.tools.values())
			yield* finishTool(tool, state, res.status);
		if (state.badTool && !wasCutOff(state.stop)) throw state.badTool;
		yield { type: 'usage', usage: toUsage(state.usage) };
		yield { type: 'finish', reason: finishReason(state.stop) };
	}
	// ping and unknown events (server tools, future types) are skipped
}

/**
 * The `ModelEvent`s of one streamed Messages response. Throws an
 * `AnthropicError` on an `error` event or a stream cut before `message_stop`;
 * ends quietly when `signal` aborts.
 */
export async function* eventsFromStream(
	res: Response,
	signal: AbortSignal,
): AsyncGenerator<ModelEvent> {
	if (res.body === null) {
		throw new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: 'Anthropic API returned no body',
			status: res.status,
		});
	}
	const requestId = res.headers.get('request-id') ?? undefined;
	const state: State = {
		tools: new Map(),
		badTool: undefined,
		opened: false,
		usage: {},
		stop: undefined,
		done: false,
	};
	try {
		for await (const sse of parseSse(res.body)) {
			const wire = parseWire(sse.data, sse.event, res.status);
			const type = sse.event === 'message' ? '' : sse.event;
			yield* wireEvents(type, wire, state, res, requestId);
			if (state.done) return;
		}
	} catch (error) {
		if (signal.aborted) return;
		if (error instanceof AnthropicError) throw error;
		throw new AnthropicError({
			kind: 'network',
			code: 'MODEL_ERROR',
			message: `Anthropic stream failed: ${(error as Error).message}`,
			cause: error,
		});
	}
	if (!signal.aborted) {
		throw new AnthropicError({
			kind: 'network',
			code: 'MODEL_ERROR',
			message: 'Anthropic stream ended before message_stop',
			status: res.status,
		});
	}
}
