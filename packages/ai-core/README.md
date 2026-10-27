# @nxgt/ai-core

Messages, Zod tools, the model port and the agent loop of nxgt-ai, a
Bun-native AI agents SDK. Not published yet; this page covers what exists:
messages and parts, usage, tools, the model port and their errors. It has no dependency; `zod`
is a peer.

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
`cacheWriteTokens`; `addUsage` sums two, `emptyUsage()` starts a total.
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
`tool-call`, `usage`, `finish`). `generate(model, req, signal)` folds one call
into an assistant `Message`, its `Usage` and a finish reason, and throws
`AiError` `ABORTED` when the signal aborts. `agentEventSchema` validates the
`AgentEvent`s the agent loop will emit. See [Model port](docs/guide/model.md).

## Errors

`AiError` has a `code` (`INVALID_TOOL_INPUT`, `TOOL_FAILED`, …) and `issues`.
See [Errors](docs/guide/errors.md).

## Documentation

[docs/](docs/README.md): guides and the [roadmap](docs/roadmap.md).
