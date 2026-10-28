import type { Message, ModelRequest, ToolResultPart } from '@nxgt/ai-core';

export type Think = boolean | 'low' | 'medium' | 'high' | 'max';

interface WireToolCall {
	function: { name: string; arguments: unknown };
}
interface WireMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	thinking?: string;
	tool_calls?: WireToolCall[];
	tool_name?: string;
}

interface WireBody {
	model: string;
	messages: WireMessage[];
	stream: true;
	tools?: unknown[];
	options?: {
		temperature?: number;
		num_predict?: number;
		num_ctx?: number;
	};
	think?: Think;
	keep_alive?: string | number;
}

export interface BodyOptions {
	model: string;
	keepAlive: string | number | undefined;
	think: Think | undefined;
	/** Context window in tokens, sent as `options.num_ctx`. */
	numCtx?: number | undefined;
}

function resultContent(part: ToolResultPart): string {
	if (part.isError) return JSON.stringify(part.error);
	return typeof part.output === 'string'
		? part.output
		: (JSON.stringify(part.output) ?? 'null');
}

function assistant(message: Message): WireMessage {
	const text: string[] = [];
	const thinking: string[] = [];
	const calls: WireToolCall[] = [];
	for (const part of message.parts) {
		if (part.type === 'text') text.push(part.text);
		else if (part.type === 'thinking') thinking.push(part.text);
		else if (part.type === 'tool-call')
			calls.push({
				function: { name: part.name, arguments: part.input ?? {} },
			});
	}
	const out: WireMessage = { role: 'assistant', content: text.join('') };
	if (thinking.length > 0) out.thinking = thinking.join('');
	if (calls.length > 0) out.tool_calls = calls;
	return out;
}

/** Core messages as wire messages; each tool result is its own message. */
export function toWireMessages(messages: readonly Message[]): WireMessage[] {
	const out: WireMessage[] = [];
	for (const message of messages) {
		if (message.role === 'assistant') {
			const wire = assistant(message);
			if (wire.content || wire.thinking || wire.tool_calls) out.push(wire);
			continue;
		}
		const text: string[] = [];
		for (const part of message.parts) {
			if (part.type === 'text') text.push(part.text);
			else if (part.type === 'tool-result')
				out.push({
					role: 'tool',
					content: resultContent(part),
					tool_name: part.name,
				});
		}
		if (text.length > 0) out.push({ role: 'user', content: text.join('') });
	}
	return out;
}

/**
 * The JSON body of `POST /api/chat` for `req`. `cache` is a no-op: Ollama
 * keeps its own KV cache. `thinking` in the request turns `think` on when the
 * adapter option is unset; Ollama has no token budget for it. `providerOptions`
 * merge shallowly into the body, except `options`, which merges key by key
 * over the mapped `temperature`, `num_predict` and `num_ctx`.
 */
export function buildBody(
	o: BodyOptions,
	req: ModelRequest,
): Record<string, unknown> {
	const messages: WireMessage[] = [];
	if (req.system !== undefined && req.system.length > 0)
		messages.push({
			role: 'system',
			content: req.system.map((b) => b.text).join('\n\n'),
		});
	messages.push(...toWireMessages(req.messages));
	const body: WireBody = {
		model: o.model,
		messages,
		stream: true,
	};
	if (req.tools !== undefined && req.tools.length > 0)
		body.tools = req.tools.map((t) => ({
			type: 'function',
			function: {
				name: t.name,
				description: t.description,
				parameters: t.inputSchema,
			},
		}));
	const options: NonNullable<WireBody['options']> = {};
	if (req.temperature !== undefined) options.temperature = req.temperature;
	if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
	if (o.numCtx !== undefined) options.num_ctx = o.numCtx;
	if (Object.keys(options).length > 0) body.options = options;
	const think = o.think ?? (req.thinking ? true : undefined);
	if (think !== undefined) body.think = think;
	if (o.keepAlive !== undefined) body.keep_alive = o.keepAlive;
	const { options: extra, ...rest } = req.providerOptions ?? {};
	const merged: Record<string, unknown> = { ...body, ...rest };
	if (extra !== undefined) {
		merged['options'] =
			typeof extra === 'object' && extra !== null && !Array.isArray(extra)
				? { ...body.options, ...extra }
				: extra;
	}
	return merged;
}
