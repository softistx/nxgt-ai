import type { AgentObserver } from './agent-types';

type Hooks = Required<AgentObserver>;

/** Calls one hook on every observer; a failing observer never breaks a run. */
export async function notify<K extends keyof Hooks>(
	observers: readonly AgentObserver[] | undefined,
	hook: K,
	info: Parameters<Hooks[K]>[0],
): Promise<void> {
	for (const observer of observers ?? []) {
		try {
			await (observer[hook] as ((i: typeof info) => unknown) | undefined)?.(
				info,
			);
		} catch {
			// Telemetry must not fail the run.
		}
	}
}
