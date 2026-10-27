import type { AgentEvent } from '@nxgt/ai-core';

export interface ExpectedCall {
	name: string;
	/** Compared deeply with the call's input; omit to check the name only. */
	input?: unknown;
}

/** The `tool-call` events of a run, as `{ name, input }`. */
export function toolCallsOf(
	events: readonly AgentEvent[],
): { name: string; input: unknown }[] {
	return events.flatMap((e) =>
		e.type === 'tool-call' ? [{ name: e.name, input: e.input }] : [],
	);
}

/** The text deltas of a run, joined. */
export function textOf(events: readonly AgentEvent[]): string {
	return events.map((e) => (e.type === 'text-delta' ? e.text : '')).join('');
}

/**
 * Throws when the run's tool calls are not `expected`, in order. Inputs are
 * compared as JSON, so it works under any test runner.
 */
export function expectToolCalls(
	events: readonly AgentEvent[],
	expected: readonly ExpectedCall[],
): void {
	const actual = toolCallsOf(events);
	const ok =
		actual.length === expected.length &&
		expected.every(
			(call, i) =>
				actual[i]?.name === call.name &&
				('input' in call
					? JSON.stringify(actual[i]?.input) === JSON.stringify(call.input)
					: true),
		);
	if (!ok) {
		throw new Error(
			`Expected tool calls ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}
