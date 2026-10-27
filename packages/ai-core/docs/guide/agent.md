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

| option          | meaning                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| `model`         | the `ModelAdapter`                                                           |
| `system`        | a string, or `SystemBlock[]` a cache-aware adapter may cache                 |
| `messages`      | the conversation so far; never mutated                                       |
| `tools`         | the tools the model may call                                                 |
| `context`       | passed to every tool                                                         |
| `signal`        | aborts the run                                                               |
| `maxSteps`      | model calls allowed, default `8`                                             |
| `budget`        | `{ maxInputTokens?, maxOutputTokens?, maxTotalTokens? }` summed over the run |
| `observers`     | `AgentObserver[]`, see below                                                 |
| `proposalTtlMs` | how long a proposed action can be confirmed, default one hour                |
| `now`           | the clock in epoch ms, default `Date.now`; tests pass a fixed one            |

## Events

Per step: `step-start`, then `text-delta`, `thinking-delta` and `tool-call` as
the model streams, `usage` (that step's), `message` (the assistant message).
When tools ran, each `tool-result` is emitted as its tool finishes and a
`message` with role `tool` follows. The run ends with an `error` event (only
for `max-steps`, `budget` and `error`) and one `done { reason, usage }`.
`agentEventSchema` validates any of them.

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

## Observers

```ts
const logger: AgentObserver = {
	onRunStart: ({ provider, model, tools }) => {},
	onModelCall: ({ step, durationMs, usage, finishReason, error }) => {},
	onToolCall: ({ step, call, result, durationMs }) => {},
	onRunEnd: (result) => {},
};
```

Hooks are awaited in order. One that throws is ignored: telemetry never fails
a run.

## AgentResult

`reason`, `messages` (what the run added after your input; append them to
continue the conversation), `text` (the last assistant text), `usage`
(summed over every model call), `steps` and `error`.
