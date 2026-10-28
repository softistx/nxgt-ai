import type {
	AiError,
	AiIssue,
	ToolErrorDetail,
	WireErrorCode,
} from './errors';

export type Role = 'user' | 'assistant' | 'tool';

export interface TextPart {
	type: 'text';
	text: string;
}

export interface ThinkingPart {
	type: 'thinking';
	text: string;
	/** The provider's proof of the block; send it back unchanged. */
	signature?: string;
	/**
	 * A provider's opaque, encrypted thinking (Anthropic `redacted_thinking`),
	 * with an empty `text`. Never read or edited; send it back unchanged.
	 */
	redacted?: string;
}

export interface ToolCallPart {
	type: 'tool-call';
	/** The model's id for this call; the result carries it as `callId`. */
	id: string;
	name: string;
	/** What the model sent, not yet validated. */
	input: unknown;
}

/** What a failed tool call reports to the model. */
export interface ToolErrorInfo {
	code: WireErrorCode;
	message: string;
	issues?: readonly AiIssue[];
	/**
	 * The tool's own reasons (a GraphQL operation's error codes), present only
	 * when the tool gave some. `code` stays the SDK's (`TOOL_FAILED`).
	 */
	details?: readonly ToolErrorDetail[];
}

interface ToolResultBase {
	type: 'tool-result';
	callId: string;
	name: string;
}

export type ToolResultPart =
	| (ToolResultBase & { isError: false; output: unknown })
	| (ToolResultBase & { isError: true; error: ToolErrorInfo });

/** A mutation waiting for a confirmation; see `confirm` on a tool. */
export interface ProposedActionPart {
	type: 'proposed-action';
	id: string;
	/** The tool to run once confirmed. */
	tool: string;
	input: unknown;
	/** What the user is asked to confirm, in words. */
	summary?: string;
	/** Epoch milliseconds after which the action can no longer be confirmed. */
	expiresAt: number;
}

export type Part =
	| TextPart
	| ThinkingPart
	| ToolCallPart
	| ToolResultPart
	| ProposedActionPart;

export interface Message {
	role: Role;
	parts: Part[];
}

/** Tokens of one model call, or the sum of several. */
export interface Usage {
	/** All input tokens of the call, the cached ones (read and write) included. */
	inputTokens: number;
	outputTokens: number;
	/** Of `inputTokens`, those served from the provider's prompt cache. */
	cacheReadTokens: number;
	/** Of `inputTokens`, those written to the provider's prompt cache. */
	cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

export function addUsage(a: Usage, b: Usage): Usage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
		cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
	};
}

/** The error result of a failed tool call, from an `AiError`. */
export function errorResult(
	call: { id: string; name: string },
	error: AiError,
): ToolResultPart {
	const info: ToolErrorInfo = { code: error.code, message: error.message };
	if (error.issues.length > 0) info.issues = error.issues;
	if (error.details.length > 0) info.details = error.details;
	return {
		type: 'tool-result',
		callId: call.id,
		name: call.name,
		isError: true,
		error: info,
	};
}
