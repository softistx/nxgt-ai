import type {
	Message,
	ModelRequest,
	Part,
	ToolResultPart,
} from '@nxgt/ai-core';

import { type Block, placeBreakpoints } from './cache';
import { DEFAULT_THINKING_BUDGET, resolveThinking } from './thinking';

export const DEFAULT_MAX_TOKENS = 4096;

interface WireBody {
	model: string;
	max_tokens: number;
	messages: WireMessage[];
	system?: Block[];
	tools?: Block[];
	temperature?: number;
	thinking?:
		| { type: 'enabled'; budget_tokens: number; display?: string }
		| { type: 'adaptive'; display?: string };
	output_config?: { effort: string };
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
			// Opaque redacted block: returned unchanged, it has no signature.
			if (part.redacted !== undefined)
				return { type: 'redacted_thinking', data: part.redacted };
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

/** `max_tokens` must exceed the thinking budget, so it is raised to fit (adaptive and effort-only have none). */
function maxTokens(asked: number | undefined, budget: number | undefined) {
	if (budget === undefined) return asked ?? DEFAULT_MAX_TOKENS;
	return Math.max(asked ?? DEFAULT_MAX_TOKENS + budget, budget + 1);
}

/**
 * The JSON body of `POST /v1/messages` for `req`. With `thinking`, the API
 * allows no `temperature` and a budget needs `max_tokens` above it, so the
 * former is dropped (adaptive thinking too) and an absent `maxTokens` leaves
 * room for the answer. `effort` alone sends `output_config` and no `thinking`.
 * A `providerOptions.thinking` override that is not `disabled` gets the same:
 * `temperature` is dropped, its `budget_tokens` is raised to the minimum and
 * `max_tokens` is resized, each unless `providerOptions` names that key.
 */
export function buildBody(
	model: string,
	req: ModelRequest,
): Record<string, unknown> {
	const thinking = req.thinking && resolveThinking(req.thinking);
	const budget = thinking?.mode === 'budget' ? thinking.budget : undefined;
	const body: WireBody = {
		model,
		max_tokens: maxTokens(req.maxTokens, budget),
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
	const display = req.thinking?.display;
	if (thinking?.mode === 'budget')
		body.thinking = {
			type: 'enabled',
			budget_tokens: thinking.budget,
			...(display && { display }),
		};
	else if (thinking?.mode === 'adaptive')
		body.thinking = { type: 'adaptive', ...(display && { display }) };
	if (req.thinking?.effort !== undefined)
		body.output_config = { effort: req.thinking.effort };
	if (body.thinking === undefined && req.temperature !== undefined)
		body.temperature = req.temperature;
	if (req.cache !== 'off') placeBreakpoints(body);
	const extra = req.providerOptions;
	const over = thinkingOverride(extra);
	if (over === undefined) return { ...body, ...extra };
	// Temperature and max_tokens follow the override as they follow the typed
	// option, unless providerOptions names them itself.
	if (!('temperature' in (extra ?? {}))) delete body.temperature;
	const merged: Record<string, unknown> = { ...body, ...extra };
	if (over.budget !== undefined) {
		merged['thinking'] = { ...over.thinking, budget_tokens: over.budget };
		if (!('max_tokens' in (extra ?? {})))
			merged['max_tokens'] = maxTokens(req.maxTokens, over.budget);
	}
	return merged;
}

/**
 * A `providerOptions.thinking` that turns thinking on: any object whose `type`
 * is not `'disabled'`. `budget` is its `budget_tokens` raised to the minimum,
 * or `undefined` when it has none (such as an adaptive type).
 */
function thinkingOverride(
	extra: Record<string, unknown> | undefined,
):
	| { thinking: Record<string, unknown>; budget: number | undefined }
	| undefined {
	const t = extra?.['thinking'];
	if (typeof t !== 'object' || t === null || Array.isArray(t)) return undefined;
	const thinking = t as Record<string, unknown>;
	if (thinking['type'] === undefined || thinking['type'] === 'disabled')
		return undefined;
	const raw = thinking['budget_tokens'];
	return {
		thinking,
		budget:
			typeof raw === 'number'
				? Math.max(raw, DEFAULT_THINKING_BUDGET)
				: undefined,
	};
}
