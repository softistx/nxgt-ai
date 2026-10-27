import type { FinishReason, ModelEvent, Usage } from '@nxgt/ai-core';
import { AnthropicError, type AnthropicErrorKind } from './errors';
import { FINISH, toUsage, type WireUsage } from './response';
import { parseSse } from './sse';

interface ToolBlock {
	id: string;
	name: string;
	json: string;
}

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
	usage: Usage;
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
	if (block?.type === 'tool_use')
		state.tools.set(wire.index ?? 0, {
			id: block.id ?? '',
			name: block.name ?? '',
			json: '',
		});
	else if (block?.type === 'text' && block.text)
		yield { type: 'text-delta', text: block.text };
	else if (block?.type === 'redacted_thinking')
		yield { type: 'thinking-delta', text: '', redacted: block.data ?? '' };
}

function* blockDeltaEvents(wire: Wire, state: State): Generator<ModelEvent> {
	const d = wire.delta;
	if (d?.type === 'text_delta' && d.text)
		yield { type: 'text-delta', text: d.text };
	else if (d?.type === 'thinking_delta')
		yield { type: 'thinking-delta', text: d.thinking ?? '' };
	else if (d?.type === 'signature_delta')
		yield { type: 'thinking-delta', text: '', signature: d.signature ?? '' };
	else if (d?.type === 'input_json_delta') {
		const tool = state.tools.get(wire.index ?? 0);
		if (tool) tool.json += d.partial_json ?? '';
	}
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
		state.usage = toUsage(wire.message.usage);
	else if (type === 'content_block_start') yield* blockStartEvents(wire, state);
	else if (type === 'content_block_delta') yield* blockDeltaEvents(wire, state);
	else if (type === 'content_block_stop') {
		const tool = state.tools.get(wire.index ?? 0);
		if (tool) {
			state.tools.delete(wire.index ?? 0);
			yield { type: 'tool-call', ...parseTool(tool, res.status) };
		}
	} else if (type === 'message_delta') {
		if (wire.delta?.stop_reason !== undefined)
			state.stop = wire.delta.stop_reason;
		if (wire.usage) state.usage = mergeUsage(state.usage, wire.usage);
	} else if (type === 'message_stop') {
		state.done = true;
		yield { type: 'usage', usage: state.usage };
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
		usage: toUsage({}),
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

function parseTool(tool: ToolBlock, status: number) {
	try {
		return {
			id: tool.id,
			name: tool.name,
			input: tool.json === '' ? {} : (JSON.parse(tool.json) as unknown),
		};
	} catch (cause) {
		throw new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: `Anthropic streamed invalid JSON input for tool ${tool.name}`,
			status,
			cause,
		});
	}
}

/** `message_delta` usage is cumulative and may carry only some fields. */
function mergeUsage(start: Usage, delta: WireUsage): Usage {
	return {
		inputTokens: delta.input_tokens ?? start.inputTokens,
		outputTokens: delta.output_tokens ?? start.outputTokens,
		cacheReadTokens: delta.cache_read_input_tokens ?? start.cacheReadTokens,
		cacheWriteTokens:
			delta.cache_creation_input_tokens ?? start.cacheWriteTokens,
	};
}
