import { eventStream } from '@alxia/core';
import { z } from 'zod';

const typed = <T extends string>(type: T) =>
	z.looseObject({ type: z.literal(type) });

/**
 * The response schema of a route that replies with `agentEvents`: one named
 * event per `AgentEvent` type, each carrying the event as JSON. Its `error`
 * data holds a code and no message, and a failed `tool-result` holds its code
 * only: see `toWireEvent`.
 *
 * ```ts
 * app.post('/chat', responds({ 200: agentEventStream }), handler);
 * ```
 */
export const agentEventStream = eventStream({
	'step-start': typed('step-start'),
	'text-delta': typed('text-delta'),
	'thinking-delta': typed('thinking-delta'),
	'tool-call': typed('tool-call'),
	'tool-result': typed('tool-result'),
	'proposed-action': typed('proposed-action'),
	message: typed('message'),
	usage: typed('usage'),
	error: typed('error'),
	done: typed('done'),
});
