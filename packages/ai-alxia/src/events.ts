import { eventStream } from '@alxia/core';
import { wireEventSchemas } from './wire';

/**
 * The response schema of a route that replies with `agentEvents`: one named
 * event per `AgentEvent` type, each with the exact wire shape of
 * `wireEventSchema`. Errors are `{ code }` only.
 *
 * ```ts
 * app.post('/chat', responds({ 200: agentEventStream }), handler);
 * ```
 */
export const agentEventStream = eventStream(wireEventSchemas);
