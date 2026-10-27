import { z } from 'zod';

const textPart = z.object({ type: z.literal('text'), text: z.string() });

const thinkingPart = z.object({
	type: z.literal('thinking'),
	text: z.string(),
	signature: z.string().optional(),
	redacted: z.string().optional(),
});

const toolCallPart = z.object({
	type: z.literal('tool-call'),
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
});

const toolResultBase = {
	type: z.literal('tool-result'),
	callId: z.string(),
	name: z.string(),
};

const toolResultPart = z.discriminatedUnion('isError', [
	z.object({
		...toolResultBase,
		isError: z.literal(false),
		output: z.unknown(),
	}),
	z.object({
		...toolResultBase,
		isError: z.literal(true),
		error: z.object({
			code: z.string(),
			message: z.string(),
			issues: z
				.array(z.object({ path: z.string(), message: z.string() }))
				.optional(),
		}),
	}),
]);

const proposedActionPart = z.object({
	type: z.literal('proposed-action'),
	id: z.string(),
	tool: z.string(),
	input: z.unknown(),
	summary: z.string().optional(),
	expiresAt: z.number(),
});

/** An `@nxgt/ai-core` `Message`; `append` parses every message with it. */
export const messageSchema = z.object({
	role: z.enum(['user', 'assistant', 'tool']),
	parts: z.array(
		z.union([
			textPart,
			thinkingPart,
			toolCallPart,
			toolResultPart,
			proposedActionPart,
		]),
	),
});

export const summarySchema = z.object({
	text: z.string(),
	/** The last message the summary covers. */
	throughMessageId: z.string(),
	/** Estimated tokens of `text`. */
	tokens: z.number().int().nonnegative(),
	createdAt: z.number(),
});

export const threadSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	title: z.string().optional(),
	meta: z.record(z.string(), z.unknown()).optional(),
	messageCount: z.number().int().nonnegative(),
	summary: summarySchema.optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
});

export const storedMessageSchema = z.object({
	id: z.string(),
	threadId: z.string(),
	/** 1-based position in the thread; ids sort by it, not by their text. */
	seq: z.number().int().positive(),
	message: messageSchema,
	createdAt: z.number(),
});
