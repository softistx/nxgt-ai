# @nxgt/ai-core

Messages, Zod tools, the model port and the agent loop of nxgt-ai, a
Bun-native AI agents SDK. It has no dependency; `zod` is a peer.

```ts
import { z } from 'zod';
import { defineTool, executeTool, toolSpec } from '@nxgt/ai-core';

const weather = defineTool({
	name: 'weather',
	description: 'Current temperature in a city',
	input: z.object({
		city: z.string().describe('City name, e.g. "Lyon"'),
		unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
	}),
	execute: async ({ city, unit }, { signal }) => ({ city, unit, degrees: 18 }),
});

toolSpec(weather); // { name, description, inputSchema } — what the model is told

await executeTool(weather, {
	type: 'tool-call',
	id: 'c1',
	name: 'weather',
	input: { city: 'Lyon' },
});
// { type: 'tool-result', callId: 'c1', name: 'weather', isError: false, output: { … } }
```

## Install

```sh
bun add @nxgt/ai-core zod
bun add -d typescript
```

Requires `"moduleResolution": "bundler"` in your `tsconfig.json`. Peers: `zod`
`>=4.6.5 <5` and `typescript` `^6.0.3 || ^7.0.0`.

## Messages

A `Message` is a `role` (`'user' | 'assistant' | 'tool'`) and `parts`. A `Part`
is one of `text`, `thinking`, `tool-call`, `tool-result` or `proposed-action`,
told apart by `type`. Messages are plain JSON: store them as they are.
`Usage` counts `inputTokens`, `outputTokens`, `cacheReadTokens` and
`cacheWriteTokens`; `inputTokens` counts all input, the cached tokens included.
`addUsage` sums two, `emptyUsage()` starts a total. `AI_ERROR_CODES` lists the
error codes; events and tool errors read from the wire type their code as
`WireErrorCode`, open to newer codes (keep a `default` branch).
See [Messages](docs/guide/messages.md).

## Tools

`defineTool({ name, description, input, output?, confirm?, execute })` takes a
Zod object schema; `execute` receives the **parsed** input, typed from the
schema, and a second argument `{ context, signal, callId }`. The model is told
the schema's JSON Schema (`z.toJSONSchema` with `io: 'input'`). `jsonSchemaTool`
wraps a JSON Schema you already have. `executeTool` validates and runs a call
and **always returns a result part**: bad input is an `INVALID_TOOL_INPUT`
result the model can correct. See [Tools](docs/guide/tools.md).

## Model port

`ModelAdapter` (`provider`, `model`, `stream(req, signal)`) is what providers
implement; it streams `ModelEvent`s (`text-delta`, `thinking-delta`,
`tool-call`, `usage`, `finish`); a text or thinking delta may carry
`start: true` to open a new part. `generate(model, req, signal)` folds one call
into an assistant `Message`, its `Usage` and a finish reason, and throws
`AiError` `ABORTED` when the signal aborts. `agentEventSchema` validates the
`AgentEvent`s the agent loop emits. See [Model port](docs/guide/model.md).

## Agent loop

`runAgent({ model, system, messages, tools, context, signal, maxSteps, budget,
observers })` returns an `AgentRun`: iterate it for `AgentEvent`s, await
`run.result` for the `AgentResult`, call `run.abort()` to stop it. Tool calls of
a step run in parallel and answer in call order; a failing tool becomes an
error result the model sees. `maxSteps` and `budget` end the run with
`MAX_STEPS` / `BUDGET_EXCEEDED`. See [Agent loop](docs/guide/agent.md).

```ts
const run = runAgent({ model, messages, tools: [weather], maxSteps: 5 });
for await (const event of run) {
	if (event.type === 'text-delta') process.stdout.write(event.text);
}
const { reason, usage } = await run.result;
```

## Proposed actions

A tool with `confirm: true` is never run by the loop: it emits a
`proposed-action` event and the model gets `{ status: 'pending', actionId }`.
Store the action, ask the user, then run it once:

```ts
const action = toProposedAction(part); // from the event or the tool message
const done = await runConfirmedAction(action, tools, { context }); // 'confirmed' | 'failed'
// or: rejectAction(action)
```

Give the tool `summarize: (input) => 'Pay invoice A1'` to fill the
confirmation line (`ProposedActionPart.summary`; a throw leaves it out). When
the user answers in a later request, append `actionOutcomeMessage(done)` (or
`actionOutcomeMessage(rejected, { reason })`) to the thread so the model learns
the outcome: a user text turn, with the error code only for a failed action.

An expired (`ACTION_EXPIRED`) or non-pending (`ACTION_NOT_PENDING`) action is
refused, and the input is validated again. `estimateTokens(text | messages)` is
a characters / 4 estimate. See [Proposed actions](docs/guide/actions.md).

## Traps

- **A tool must honour its `signal`.** After an abort the run does not wait
  for a tool that ignores `ToolContext.signal`: it answers `ABORTED` at once
  and the run ends `aborted`, but the tool keeps running in the background
  and its side effects still happen. Pass the signal to `fetch`, queries and
  timers.
- **`AgentRun` has one consumer.** Events are read from a shared queue, so two
  `for await` loops split them. Leaving the loop early (`break`, `return`, a
  throw) does not abort the run: it goes on and `run.result` still settles.
  Call `run.abort()` to stop it.

## Errors

`AiError` has a `code` (`INVALID_TOOL_INPUT`, `TOOL_FAILED`, …) and `issues`.
See [Errors](docs/guide/errors.md).

## Documentation

[docs/](docs/README.md): guides, [troubleshooting](docs/troubleshooting.md) and the [roadmap](docs/roadmap.md).
