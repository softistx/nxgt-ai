import { type SseComment, sseComment } from '@alxia/core';
import type { AgentEvent, AgentRun } from '@nxgt/ai-core';
import type { agentEventStream } from './events';
import { codeOf, toWireEvent } from './wire';

/** One value `agentEvents` yields: a named event, or a heartbeat comment. */
export type AgentStreamItem =
	| ReturnType<(typeof agentEventStream)['event']>
	| SseComment;

export interface AgentEventsOptions {
	/**
	 * Stops the stream and aborts the run when it aborts: pass `ctx.ai.signal`.
	 * Without it the run is stopped only when alxia closes the generator, which
	 * a generator waiting on the model does not see until it next yields.
	 */
	signal?: AbortSignal;
	/** Writes a `: heartbeat` comment after this many ms without an event. Default: none. */
	heartbeatMs?: number;
}

const ABORTED = Symbol('aborted');
const BEAT = Symbol('beat');

function aborted(signal: AbortSignal | undefined) {
	let onAbort = () => {};
	const promise = new Promise<typeof ABORTED>((resolve) => {
		onAbort = () => resolve(ABORTED);
		if (signal?.aborted) onAbort();
		else signal?.addEventListener('abort', onAbort, { once: true });
	});
	return { promise, stop: () => signal?.removeEventListener('abort', onAbort) };
}

/**
 * Streams a run's events as Server-Sent Events: reply with it from a route
 * whose response is `agentEventStream`. alxia writes the frames and the
 * headers (`text/event-stream`, `no-cache`, `x-accel-buffering: no`).
 *
 * - The stream ends after the run's `done` event.
 * - On a disconnect (`options.signal`) or when alxia closes the generator,
 *   the run is aborted and the stream ends with no further event.
 * - An `error` event holds a code only; a stream that fails ends with an
 *   `error` event of code `INTERNAL_ERROR` (or the `AiError`'s code).
 *
 * ```ts
 * ({ ai, reply }) => reply(200, agentEvents(runAgent({ model, messages, ...ai }), ai))
 * ```
 */
export async function* agentEvents(
	run: AgentRun,
	options: AgentEventsOptions = {},
): AsyncGenerator<AgentStreamItem, void, undefined> {
	const { signal, heartbeatMs } = options;
	const iterator = run[Symbol.asyncIterator]();
	const stop = aborted(signal);
	try {
		let pending = iterator.next();
		while (true) {
			let beat: Timer | undefined;
			const racers: Promise<unknown>[] = [pending, stop.promise];
			if (heartbeatMs !== undefined && heartbeatMs > 0) {
				racers.push(
					new Promise((resolve) => {
						beat = setTimeout(() => resolve(BEAT), heartbeatMs);
					}),
				);
			}
			const won = await Promise.race(racers).finally(() => clearTimeout(beat));
			if (won === ABORTED) return;
			if (won === BEAT) {
				yield sseComment('heartbeat');
				continue;
			}
			const step = won as IteratorResult<AgentEvent>;
			if (step.done) return;
			const wire = toWireEvent(step.value);
			yield { event: wire.type, data: wire } as AgentStreamItem;
			if (step.value.type === 'done') return;
			pending = iterator.next();
		}
	} catch (error) {
		if (!signal?.aborted) {
			const data = { type: 'error' as const, error: { code: codeOf(error) } };
			yield { event: 'error' as const, data };
		}
	} finally {
		stop.stop();
		run.abort();
		void run.result.catch(() => {});
	}
}
