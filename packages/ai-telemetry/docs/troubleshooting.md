# Troubleshooting

- [No spans appear](#no-spans-appear)
- [Prompts and tool results are missing from spans](#prompts-and-tool-results-are-missing-from-spans)
- [An aborted run shows as cancelled, not failed](#an-aborted-run-shows-as-cancelled-not-failed)
- [Concurrent runs and `runId`](#concurrent-runs-and-runid)
- [Spans do not nest under my request span](#spans-do-not-nest-under-my-request-span)

## No spans appear

**When:** the run works, but your backend receives nothing.
**Why:** the observer writes to the telemetry passed in `aiTelemetry({ telemetry })`, else the one in scope (`withTelemetry`) or installed. With none, the run is untouched and nothing is emitted, silently.
**Fix:**

```ts
import { aiTelemetry } from '@nxgt/ai-telemetry';

runAgent({ model, messages, tools, observers: [aiTelemetry({ telemetry })] });
```

Also check that `observers` is on the `runAgent` call and that `@nxgt/telemetry` is the same installed copy as the one your app uses (one version in the lockfile).

## Prompts and tool results are missing from spans

**When:** `ai.agent.run` has usage and timings but no `gen_ai.input.messages` or `gen_ai.output.messages`, and tool spans lack arguments and results.
**Why:** content is never recorded by default, since prompts and results can hold personal data.
**Fix:**

```ts
aiTelemetry({ recordContent: true });
```

Turn it on only where your retention policy allows it.

## An aborted run shows as cancelled, not failed

**When:** a run you aborted has no error status on its spans.
**Why:** an abort is recorded as a cancellation (`ai.error.code` is `ABORTED`), not as a failure. Other failures fail the span with their `AiError` code.
**Fix:** filter on `ai.error.code`, not only on span status.

## Concurrent runs and `runId`

**When:** many runs share one observer, or you start a run with the same `runId` twice.
**Why:** open spans are keyed by the `runId` carried by every hook, so one observer serves any number of concurrent runs. Reusing a `runId` while the first is open ends the first run's spans early.
**Fix:** build the observer once; let the loop generate run ids, or make yours unique.

```ts
const observer = aiTelemetry(); // module level
await Promise.all(
	jobs.map((j) => collect(runAgent({ ...j, observers: [observer] }))),
);
```

## Spans do not nest under my request span

**When:** `ai.agent.run` appears as a root span next to your HTTP span.
**Why:** the run span takes its parent from the telemetry context active at `onRunStart`.
**Fix:** start the run inside the request's context.

```ts
await withTelemetry(telemetry, () =>
	collect(runAgent({ model, messages, observers: [aiTelemetry()] })),
);
```
