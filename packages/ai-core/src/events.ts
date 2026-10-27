import { z } from 'zod';
import type { WireErrorCode } from './errors';
import type {
	Message,
	ProposedActionPart,
	ToolResultPart,
	Usage,
} from './message';

/** Why a run ended. */
export type RunEndReason =
	| 'end'
	| 'max-tokens'
	| 'refusal'
	| 'max-steps'
	| 'budget'
	| 'aborted'
	| 'error';

/** A run end reason as read from the wire: a known one, or a newer server's. */
export type WireRunEndReason = RunEndReason | (string & {});

/** What `runAgent` emits, in order, one run. */
export type AgentEvent =
	| { type: 'step-start'; step: number; runId: string }
	| { type: 'text-delta'; text: string; start?: true }
	| {
			type: 'thinking-delta';
			text: string;
			start?: true;
			signature?: string;
			redacted?: string;
	  }
	| { type: 'tool-call'; id: string; name: string; input: unknown }
	| { type: 'tool-result'; result: ToolResultPart }
	| { type: 'proposed-action'; action: ProposedActionPart }
	| { type: 'message'; message: Message }
	| { type: 'usage'; usage: Usage }
	| { type: 'error'; error: { code: WireErrorCode; message: string } }
	| { type: 'done'; reason: WireRunEndReason; usage: Usage };

const usageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheWriteTokens: z.number(),
});

/**
 * Known codes are `AI_ERROR_CODES`; any string parses, so a client older than
 * the server that sent the event still reads it.
 */
const codeSchema = z.custom<WireErrorCode>(
	(value) => typeof value === 'string',
);

const resultBase = {
	type: z.literal('tool-result'),
	callId: z.string(),
	name: z.string(),
};

const toolResultSchema = z.discriminatedUnion('isError', [
	z.object({ ...resultBase, isError: z.literal(false), output: z.unknown() }),
	z.object({
		...resultBase,
		isError: z.literal(true),
		error: z.object({
			code: codeSchema,
			message: z.string(),
			issues: z
				.array(z.object({ path: z.string(), message: z.string() }))
				.readonly()
				.optional(),
		}),
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
	toolResultSchema,
	proposedActionSchema,
]);

const messageSchema = z.object({
	role: z.enum(['user', 'assistant', 'tool']),
	parts: z.array(partSchema),
});

/** Validates an `AgentEvent`, e.g. one read back from an SSE stream. */
export const agentEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('step-start'),
		step: z.number().int(),
		runId: z.string(),
	}),
	z.object({
		type: z.literal('text-delta'),
		text: z.string(),
		start: z.literal(true).optional(),
	}),
	z.object({
		type: z.literal('thinking-delta'),
		text: z.string(),
		start: z.literal(true).optional(),
		signature: z.string().optional(),
		redacted: z.string().optional(),
	}),
	z.object({
		type: z.literal('tool-call'),
		id: z.string(),
		name: z.string(),
		input: z.unknown(),
	}),
	z.object({ type: z.literal('tool-result'), result: toolResultSchema }),
	z.object({
		type: z.literal('proposed-action'),
		action: proposedActionSchema,
	}),
	z.object({ type: z.literal('message'), message: messageSchema }),
	z.object({ type: z.literal('usage'), usage: usageSchema }),
	z.object({
		type: z.literal('error'),
		error: z.object({ code: codeSchema, message: z.string() }),
	}),
	z.object({
		type: z.literal('done'),
		reason: z.custom<WireRunEndReason>((value) => typeof value === 'string'),
		usage: usageSchema,
	}),
]);
