import type { AgentEvent } from '@nxgt/ai-core';

/** An event stream, or a run that holds one in `events` (S4's `AgentRun`). */
export type EventSource<E> = AsyncIterable<E> | { events: AsyncIterable<E> };

/** Drains a run's events into an array, in order. */
export async function collect<E = AgentEvent>(
	run: EventSource<E>,
): Promise<E[]> {
	const source = Symbol.asyncIterator in run ? run : run.events;
	const out: E[] = [];
	for await (const event of source) out.push(event);
	return out;
}
