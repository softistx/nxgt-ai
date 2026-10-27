import {
	currentContext,
	runWithContext,
	type SpanScope,
	span,
	type Telemetry,
	type TelemetryContext,
	withTelemetry,
} from '@nxgt/telemetry';

/** An open span that an observer hook closes later. */
export interface SpanHandle {
	readonly scope: SpanScope;
	/** The context children run in, so they nest under this span. */
	readonly context: TelemetryContext | undefined;
	end(): void;
}

function inContext<T>(
	parent: TelemetryContext | undefined,
	telemetry: Telemetry | undefined,
	fn: () => T,
): T {
	if (parent) return runWithContext(parent, fn);
	return telemetry ? withTelemetry(telemetry, fn) : fn();
}

/**
 * Opens a span now and keeps it open until `end()`. `span()` takes a block, so
 * the block hands back a promise that `end()` resolves; the span is recorded
 * when it does. Without telemetry in scope nothing is emitted, and the handle
 * still works.
 */
export function openSpan(
	name: string,
	attributes: Readonly<Record<string, unknown>>,
	parent: TelemetryContext | undefined,
	telemetry: Telemetry | undefined,
): SpanHandle {
	let scope: SpanScope | undefined;
	let context: TelemetryContext | undefined;
	let end = () => {};
	const done = new Promise<void>((resolve) => {
		end = resolve;
	});
	// The block runs synchronously inside `span`, so `scope` is set on return.
	void inContext(parent, telemetry, () =>
		span(name, { attributes }, (opened) => {
			scope = opened;
			context = currentContext();
			return done;
		}),
	).catch(() => {});
	return { scope: scope as SpanScope, context, end };
}
