# The agent loop

`runAgent` calls the model, runs the tools it asks for, sends the results back
and repeats until the model stops, a limit is reached or the run is aborted.

```ts
import { defineTool, runAgent } from '@nxgt/ai-core';
import { z } from 'zod';

const weather = defineTool({
	name: 'weather',
	description: 'Current temperature of a city',
	input: z.object({ city: z.string() }),
	execute: async ({ city }, { signal }) => lookup(city, signal),
});

const run = runAgent({
	model, // any ModelAdapter
	system: 'You answer weather questions.',
	messages: [
		{ role: 'user', parts: [{ type: 'text', text: 'Weather in Oslo?' }] },
	],
	tools: [weather],
	context: { language: 'en' }, // reaches every tool as ToolContext.context
	signal: request.signal,
	maxSteps: 8,
	budget: { maxTotalTokens: 20_000 },
});

for await (const event of run) {
	if (event.type === 'text-delta') process.stdout.write(event.text);
}
const { reason, text, messages, usage } = await run.result;
```

The run starts when `runAgent` is called. Events buffer until you read them, so
you may await `run.result` alone. `result` never rejects.

## Options

| option          | meaning                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `model`         | the `ModelAdapter`                                                                                           |
| `system`        | a string, or `SystemBlock[]` a cache-aware adapter may cache                                                 |
| `messages`      | the conversation so far; never mutated                                                                       |
| `tools`         | the tools the model may call                                                                                 |
| `context`       | passed to every tool                                                                                         |
| `signal`        | aborts the run                                                                                               |
| `maxSteps`      | model calls allowed, default `8`                                                                             |
| `budget`        | `{ maxInputTokens?, maxOutputTokens?, maxTotalTokens? }` summed over the run; input counts cached tokens too |
| `observers`     | `AgentObserver[]`, see below                                                                                 |
| `proposalTtlMs` | how long a proposed action can be confirmed, default one hour                                                |
| `now`           | the clock in epoch ms, default `Date.now`; tests pass a fixed one                                            |

## Events

Per step: `step-start`, then `text-delta`, `thinking-delta` and `tool-call` as
the model streams, `usage` (that step's), `message` (the assistant message).
When tools ran, each `tool-result` is emitted as its tool finishes and a
`message` with role `tool` follows. The run ends with an `error` event (only
for `max-steps`, `budget` and `error`) and one `done { reason, usage }`.
`agentEventSchema` validates any of them; it accepts an unknown error code or
`done.reason` (typed `WireErrorCode` / `WireRunEndReason`), so keep a `default`
branch when you switch on them.

## Tools

The calls of one step run in parallel. Their results go back to the model in
**call order**, whatever order they finish in. A tool that throws, a tool name
the model invented and an invalid input each become an `isError` tool result
(`TOOL_FAILED`, `UNKNOWN_TOOL`, `INVALID_TOOL_INPUT`); the loop carries on and
the model can correct itself.

A tool with `confirm: true` is **never executed** by the loop. A valid call is
proposed instead: a `proposed-action` event, a `proposed-action` part after the
results in the tool message, and a tool result `{ status: 'pending', actionId }`
for the model. See [Proposed actions](actions.md).

## Limits

Limits are checked before each model call, so the tools of the last allowed
step still run and their results are in `result.messages`.

A step that ends `max-tokens`, `end` or `refusal` while holding complete tool
calls does not run them. Each call gets an error result (`MODEL_ERROR`, "The
call was cut off ...") in a `tool` message right after the assistant message,
so the history stays valid: Anthropic answers 400 to a `tool_use` with no
`tool_result` on the next turn.

| `reason`     | when                                        | `error.code`      |
| ------------ | ------------------------------------------- | ----------------- |
| `end`        | the model finished its answer               | none              |
| `max-tokens` | the model hit its output limit              | none              |
| `refusal`    | the model refused                           | none              |
| `max-steps`  | `maxSteps` model calls were made            | `MAX_STEPS`       |
| `budget`     | a `budget` limit was reached or passed      | `BUDGET_EXCEEDED` |
| `aborted`    | `signal` or `run.abort()`                   | `ABORTED`         |
| `error`      | the model call failed (`RATE_LIMITED`, ...) | the adapter's     |

## Abort

`run.abort(reason?)` and the `signal` option do the same: the model stream is
closed and the signal each tool receives (`ToolContext.signal`) aborts. A tool
cut short answers with an `ABORTED` result so `result.messages` stays a valid
conversation; a model call cut short adds nothing. The run ends `aborted`.

### Tools must honour their signal

The loop does not wait for a tool that ignores its signal. When the run
aborts, every tool still running answers `ABORTED` at once, the run ends
`aborted`, and whatever the tool returns later is dropped. The tool itself is
not stopped: it finishes in the background and its side effects (a write, a
payment, a message) still happen. Pass `ToolContext.signal` to everything that
can wait.

```ts
const search = defineTool({
	name: 'search',
	description: 'Searches the catalogue',
	input: z.object({ q: z.string() }),
	execute: async ({ q }, { signal }) => {
		const res = await fetch(`https://example.test/search?q=${q}`, { signal });
		return res.json();
	},
});
```

### One consumer, and leaving early

An `AgentRun` is a single-consumer iterator: its events sit in one queue and
each is delivered once, so two `for await` loops split the events between
them. Leaving a loop early (`break`, `return`, an exception) does not abort the
run. It keeps calling the model and the tools, and `run.result` still settles.
Call `run.abort()` when you stop reading.

```ts
const run = runAgent({ model, messages, tools });
try {
	for await (const event of run) {
		if (event.type === 'text-delta' && enough(event.text)) break;
	}
} finally {
	run.abort(); // a no-op once the run has ended
}
```

## Observers

```ts
const logger: AgentObserver = {
	onRunStart: ({ runId, provider, model, tools }) => {},
	onModelStart: ({ runId, step }) => {},
	onModelCall: ({ runId, step, durationMs, usage, finishReason, error }) => {},
	onToolStart: ({ runId, step, call }) => {},
	onToolCall: ({ runId, step, call, result, durationMs }) => {},
	onRunEnd: (result) => {},
};
```

Hooks are awaited in order. One that throws is ignored: telemetry never fails
a run. `onModelStart` and `onToolStart` fire before the work, so an observer
can open a span that covers it; each is followed by its `onModelCall` or
`onToolCall`, which carries the outcome. Every hook receives the run's
`runId` (also on `AgentResult` and on each `step-start` event), so one observer
built once can serve concurrent runs: key its state by `runId`. The id is a
`crypto.randomUUID()`; a test passes `newId` to `runAgent` for a fixed one.

## AgentResult

`runId`, `reason`, `messages` (what the run added after your input; append them to
continue the conversation), `text` (the last assistant text), `usage`
(summed over every model call), `steps` and `error`.
