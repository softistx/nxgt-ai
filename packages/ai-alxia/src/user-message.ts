import { z } from 'zod';

/**
 * A user message as a request body may carry it: the `user` role and text
 * parts only. Any other part (a forged `proposed-action`, a `tool-result`)
 * fails the parse, so nothing but the user's text reaches the memory store.
 */
export const userMessageSchema = z.object({
	role: z.literal('user'),
	parts: z
		.array(z.object({ type: z.literal('text'), text: z.string() }))
		.min(1),
});

/** A user message of a request body, text parts only. */
export type UserMessage = z.infer<typeof userMessageSchema>;
