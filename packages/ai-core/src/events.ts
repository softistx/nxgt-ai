import { z } from 'zod';
import type { AiErrorCode } from './errors';
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
	| 'error'
	| 'proposed';

/** What `runAgent` emits, in order, one run. */
export type AgentEvent =
	| { type: 'step-start'; step: number }
	| { type: 'text-delta'; text: string }
	| { type: 'thinking-delta'; text: string; signature?: string }
	| { type: 'tool-call'; id: string; name: string; input: unknown }
	| { type: 'tool-result'; result: ToolResultPart }
	| { type: 'proposed-action'; action: ProposedActionPart }
	| { type: 'message'; message: Message }
	| { type: 'usage'; usage: Usage }
	| { type: 'error'; error: { code: AiErrorCode; message: string } }
	| { type: 'done'; reason: RunEndReason; usage: Usage };

const usageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheWriteTokens: z.number(),
});

const codeSchema = z.enum([
	'INVALID_TOOL_DEFINITION',
	'INVALID_TOOL_INPUT',
	'INVALID_TOOL_OUTPUT',
	'TOOL_FAILED',
	'UNKNOWN_TOOL',
	'MODEL_ERROR',
	'RATE_LIMITED',
	'AUTHENTICATION',
	'ABORTED',
	'MAX_STEPS',
	'BUDGET_EXCEEDED',
]);

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
});

const partSchema = z.union([
	z.object({ type: z.literal('text'), text: z.string() }),
	z.object({
		type: z.literal('thinking'),
		text: z.string(),
		signature: z.string().optional(),
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
	z.object({ type: z.literal('step-start'), step: z.number().int() }),
	z.object({ type: z.literal('text-delta'), text: z.string() }),
	z.object({
		type: z.literal('thinking-delta'),
		text: z.string(),
		signature: z.string().optional(),
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
		reason: z.enum([
			'end',
			'max-tokens',
			'refusal',
			'max-steps',
			'budget',
			'aborted',
			'error',
			'proposed',
		]),
		usage: usageSchema,
	}),
]);
