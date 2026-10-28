import { type AgentEvent, AiError } from '@nxgt/ai-core';

/** An event as the client reads it: errors are codes, never messages. */
export type WireEvent = Record<string, unknown> & { type: AgentEvent['type'] };

/** The code a client sees for a failure that has none of its own. */
export const INTERNAL_ERROR = 'INTERNAL_ERROR';

/** The code of a thrown value: an `AiError`'s, else `INTERNAL_ERROR`. */
export function codeOf(error: unknown): string {
	return error instanceof AiError ? error.code : INTERNAL_ERROR;
}

/**
 * The event a client may read. A run's `error` event keeps its `code` and
 * loses its `message`; a failed `tool-result` keeps its `code` and loses its
 * `message` and `issues`; every other event is sent as it is. Messages can
 * carry what a model, a tool or a provider said, so they stay on the server.
 */
export function toWireEvent(event: AgentEvent): WireEvent {
	if (event.type === 'error') {
		return { type: 'error', error: { code: event.error.code } };
	}
	if (event.type === 'tool-result' && event.result.isError) {
		const { callId, name, error } = event.result;
		return {
			type: 'tool-result',
			result: {
				type: 'tool-result',
				callId,
				name,
				isError: true,
				error: { code: error.code },
			},
		};
	}
	return event as WireEvent;
}
