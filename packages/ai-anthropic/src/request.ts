import {
	AiError,
	type Message,
	type ModelRequest,
	type Part,
	type ThinkingOptions,
	type ToolResultPart,
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

const family = (...ids: string[]) =>
	new RegExp(`^claude-(?:${ids.join('|')})(?:[-@]|$)`);
/** Models whose API rejects `budget_tokens` with a 400 (adaptive only). */
const NO_BUDGET = family(
	'fable-5',
	'mythos-5',
	'sonnet-5',
	'opus-5',
	'opus-4-7',
	'opus-4-8',
	'haiku-5',
);
/** Models before adaptive thinking (Claude 4.6). */
const NO_ADAPTIVE = family('haiku-4-5', 'sonnet-4-5', 'opus-4-5', 'opus-4-1');
/** Models without the effort parameter. */
const NO_EFFORT = family('haiku-4-5', 'sonnet-4-5');
/** Models whose effort stops at `high` (`max` on 4.6; `xhigh` came with 4.7). */
const NO_XHIGH = family('opus-4-5', 'opus-4-6', 'sonnet-4-6');

const invalid = (message: string) =>
	new AiError('INVALID_REQUEST', `Anthropic thinking: ${message}`);

type Resolved =
	| { mode: 'budget'; budget: number }
	| { mode: 'adaptive' }
	| { mode: 'none' };

/**
 * Refuses, before any call, the combinations the API rejects with a 400 and
 * that the model id lets us know. An unknown model id is never refused.
 */
function resolveThinking(model: string, t: ThinkingOptions): Resolved {
	const mode =
		t.mode ??
		(t.budgetTokens === undefined && t.effort !== undefined
			? 'none'
			: 'budget');
	if (mode === 'adaptive' && t.budgetTokens !== undefined)
		throw invalid('`budgetTokens` cannot be used with `mode: "adaptive"`');
	if (mode === 'none' && t.display !== undefined)
		throw invalid('`display` needs `mode: "adaptive"` or `budgetTokens`');
	if (mode === 'budget' && NO_BUDGET.test(model))
		throw invalid(
			`${model} rejects \`budgetTokens\`; use \`mode: "adaptive"\` with \`effort\``,
		);
	if (mode === 'adaptive' && NO_ADAPTIVE.test(model))
		throw invalid(
			`${model} has no adaptive thinking; use \`budgetTokens\` instead`,
		);
	if (t.effort !== undefined) {
		if (NO_EFFORT.test(model))
			throw invalid(`${model} has no \`effort\` parameter`);
		if (t.effort === 'xhigh' && NO_XHIGH.test(model))
			throw invalid(`${model} does not support effort "xhigh"`);
		if (t.effort === 'max' && family('opus-4-5').test(model))
			throw invalid(`${model} does not support effort "max"`);
	}
	if (mode === 'budget')
		return {
			mode,
			budget: Math.max(
				t.budgetTokens ?? DEFAULT_THINKING_BUDGET,
				DEFAULT_THINKING_BUDGET,
			),
		};
	return { mode };
}

/**
 * The JSON body of `POST /v1/messages` for `req`. With `thinking`, the API
 * allows no `temperature` (adaptive too) and needs `max_tokens` above a
 * budget, so the former is dropped and an absent `maxTokens` leaves room for the answer.
 */
export function buildBody(
	model: string,
	req: ModelRequest,
): Record<string, unknown> {
	const thinking = req.thinking && resolveThinking(model, req.thinking);
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
	return { ...body, ...req.providerOptions };
}
