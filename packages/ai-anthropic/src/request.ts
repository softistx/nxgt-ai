import type {
	Message,
	ModelRequest,
	Part,
	ToolResultPart,
} from '@nxgt/ai-core';

import { type Block, placeBreakpoints } from './cache';

export const DEFAULT_MAX_TOKENS = 4096;
/** The API's minimum thinking budget; used when the request names none. */
export const DEFAULT_THINKING_BUDGET = 1024;

interface WireBody {
	model: string;
	max_tokens: number;
	messages: WireMessage[];
	system?: Block[];
	tools?: Block[];
	temperature?: number;
	thinking?: { type: 'enabled'; budget_tokens: number };
}
interface WireMessage {
	role: 'user' | 'assistant';
	content: Block[];
}

function resultContent(part: ToolResultPart): string {
	if (part.isError) return JSON.stringify(part.error);
	return typeof part.output === 'string'
		? part.output
		: (JSON.stringify(part.output) ?? 'null');
}

function toBlock(part: Part): Block | undefined {
	switch (part.type) {
		case 'text':
			return part.text === '' ? undefined : { type: 'text', text: part.text };
		case 'thinking':
			// Anthropic rejects a thinking block without its signature.
			return part.signature === undefined
				? undefined
				: { type: 'thinking', thinking: part.text, signature: part.signature };
		case 'tool-call':
			return {
				type: 'tool_use',
				id: part.id,
				name: part.name,
				input: part.input ?? {},
			};
		case 'tool-result':
			return {
				type: 'tool_result',
				tool_use_id: part.callId,
				content: resultContent(part),
				...(part.isError ? { is_error: true } : {}),
			};
		case 'proposed-action':
			// Pending actions are for the user, not the model.
			return undefined;
	}
}

/** Core messages as wire messages; a `tool` message is a user message. */
export function toWireMessages(messages: readonly Message[]): WireMessage[] {
	const out: WireMessage[] = [];
	for (const message of messages) {
		const role = message.role === 'assistant' ? 'assistant' : 'user';
		const content: Block[] = [];
		for (const part of message.parts) {
			const block = toBlock(part);
			if (block) content.push(block);
		}
		if (content.length === 0) continue;
		const last = out.at(-1);
		if (last?.role === role) last.content.push(...content);
		else out.push({ role, content });
	}
	return out;
}

/**
 * The JSON body of `POST /v1/messages` for `req`. With `thinking`, the API
 * allows no `temperature` and needs `max_tokens` above the budget, so the
 * former is dropped and an absent `maxTokens` leaves room for the answer.
 */
export function buildBody(
	model: string,
	req: ModelRequest,
): Record<string, unknown> {
	const budget = req.thinking
		? Math.max(
				req.thinking.budgetTokens ?? DEFAULT_THINKING_BUDGET,
				DEFAULT_THINKING_BUDGET,
			)
		: undefined;
	const body: WireBody = {
		model,
		max_tokens:
			req.maxTokens ?? DEFAULT_MAX_TOKENS + (budget === undefined ? 0 : budget),
		messages: toWireMessages(req.messages),
	};
	if (req.system !== undefined && req.system.length > 0) {
		body.system = req.system.map((b) => ({ type: 'text', text: b.text }));
	}
	if (req.tools !== undefined && req.tools.length > 0) {
		body.tools = req.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.inputSchema,
		}));
	}
	if (budget !== undefined)
		body.thinking = { type: 'enabled', budget_tokens: budget };
	else if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.cache !== 'off') placeBreakpoints(body);
	return { ...body, ...req.providerOptions };
}
