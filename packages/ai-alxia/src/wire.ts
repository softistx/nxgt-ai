import {
	type AgentEvent,
	AiError,
	type Message,
	type Part,
	type ToolResultPart,
} from '@nxgt/ai-core';
import { z } from 'zod';

/** The code a client sees for a failure that has none of its own. */
export const INTERNAL_ERROR = 'INTERNAL_ERROR';

/** The code of a thrown value: an `AiError`'s, else `INTERNAL_ERROR`. */
export function codeOf(error: unknown): string {
	return error instanceof AiError ? error.code : INTERNAL_ERROR;
}

const code = z.string();

const usageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheWriteTokens: z.number(),
});

const toolResultBase = {
	type: z.literal('tool-result'),
	callId: z.string(),
	name: z.string(),
};

/** A tool result as sent: a failure is its code, with no message and no issues. */
export const wireToolResultSchema = z.discriminatedUnion('isError', [
	z.object({
		...toolResultBase,
		isError: z.literal(false),
		output: z.unknown(),
	}),
	z.object({
		...toolResultBase,
		isError: z.literal(true),
		error: z.object({ code }),
	}),
]);

const proposedActionSchema = z.object({
	type: z.literal('proposed-action'),
	id: z.string(),
	tool: z.string(),
	input: z.unknown(),
	summary: z.string().optional(),
	expiresAt: z.number(),
});

const partSchema = z.union([
	z.object({ type: z.literal('text'), text: z.string() }),
	z.object({
		type: z.literal('thinking'),
		text: z.string(),
		signature: z.string().optional(),
		redacted: z.string().optional(),
	}),
	z.object({
		type: z.literal('tool-call'),
		id: z.string(),
		name: z.string(),
		input: z.unknown(),
	}),
	wireToolResultSchema,
	proposedActionSchema,
]);

const messageSchema = z.object({
	role: z.enum(['user', 'assistant', 'tool']),
	parts: z.array(partSchema),
});

/** Each wire event by its `type`, which is also its SSE `event:` name. */
export const wireEventSchemas = {
	'step-start': z.object({
		type: z.literal('step-start'),
		step: z.number().int(),
		runId: z.string(),
	}),
	'text-delta': z.object({
		type: z.literal('text-delta'),
		text: z.string(),
		start: z.literal(true).optional(),
	}),
	'thinking-delta': z.object({
		type: z.literal('thinking-delta'),
		text: z.string(),
		start: z.literal(true).optional(),
		signature: z.string().optional(),
		redacted: z.string().optional(),
	}),
	'tool-call': z.object({
		type: z.literal('tool-call'),
		id: z.string(),
		name: z.string(),
		input: z.unknown(),
	}),
	'tool-result': z.object({
		type: z.literal('tool-result'),
		result: wireToolResultSchema,
	}),
	'proposed-action': z.object({
		type: z.literal('proposed-action'),
		action: proposedActionSchema,
	}),
	message: z.object({ type: z.literal('message'), message: messageSchema }),
	usage: z.object({ type: z.literal('usage'), usage: usageSchema }),
	error: z.object({ type: z.literal('error'), error: z.object({ code }) }),
	done: z.object({
		type: z.literal('done'),
		reason: z.string(),
		usage: usageSchema,
	}),
} as const;

/**
 * Validates an event as read from the stream (unlike `agentEventSchema` of
 * `@nxgt/ai-core`, which wants the `message` the wire leaves out).
 */
export const wireEventSchema = z.discriminatedUnion('type', [
	wireEventSchemas['step-start'],
	wireEventSchemas['text-delta'],
	wireEventSchemas['thinking-delta'],
	wireEventSchemas['tool-call'],
	wireEventSchemas['tool-result'],
	wireEventSchemas['proposed-action'],
	wireEventSchemas.message,
	wireEventSchemas.usage,
	wireEventSchemas.error,
	wireEventSchemas.done,
]);

/** An event as the client reads it: errors are codes, never messages. */
export type WireEvent = z.infer<typeof wireEventSchema>;
export type WireToolResult = z.infer<typeof wireToolResultSchema>;

function wireResult(result: ToolResultPart): WireToolResult {
	if (!result.isError) return result;
	const { type, callId, name, error } = result;
	return { type, callId, name, isError: true, error: { code: error.code } };
}

function wirePart(part: Part): z.infer<typeof partSchema> {
	return part.type === 'tool-result' ? wireResult(part) : part;
}

function wireMessage(message: Message): z.infer<typeof messageSchema> {
	return { role: message.role, parts: message.parts.map(wirePart) };
}

/**
 * The event a client may read. Everywhere an event holds an error (an
 * `error` event, a failed `tool-result`, a failed result inside a `message`)
 * only its `code` is kept: messages and issues can hold what a provider, a
 * tool or an exception said, so they stay on the server.
 */
export function toWireEvent(event: AgentEvent): WireEvent {
	switch (event.type) {
		case 'error':
			return { type: 'error', error: { code: event.error.code } };
		case 'tool-result':
			return { type: 'tool-result', result: wireResult(event.result) };
		case 'message':
			return { type: 'message', message: wireMessage(event.message) };
		default:
			return event;
	}
}
