# nxgt-ai

Bun-native AI agents SDK: a core agent loop with zod-typed tools, Anthropic and Ollama adapters on Bun `fetch`, deterministic test helpers and telemetry. Memory, GraphQL tools, MCP and alxia integration are planned (see [docs/roadmap.md](docs/roadmap.md)).

## Packages

| package                                       | what it is                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`@nxgt/ai-core`](packages/ai-core)           | messages, zod tools, the model port, `runAgent`, proposed actions that wait for confirmation |
| [`@nxgt/ai-anthropic`](packages/ai-anthropic) | the Anthropic Messages API as a model: streaming, thinking, prompt caching, retries          |
| [`@nxgt/ai-ollama`](packages/ai-ollama)       | a local Ollama server as a model                                                             |
| [`@nxgt/ai-testing`](packages/ai-testing)     | `fakeModel` and `collect` to test agents without a network                                   |
| [`@nxgt/ai-memory`](packages/ai-memory)       | conversation memory: an owner-scoped store, in-process, MongoDB and Redis stores, compaction |
| [`@nxgt/ai-graphql`](packages/ai-graphql)     | GraphQL operations as tools, with forbidden fields and confirmed mutations                   |
| [`@nxgt/ai-alxia`](packages/ai-alxia)         | an alxia middleware (abort, language, observers) and a Server-Sent Events reply for a run    |
| [`@nxgt/ai-telemetry`](packages/ai-telemetry) | an observer that writes a run as `@nxgt/telemetry` spans with `gen_ai.*` attributes          |

## Install

```sh
bun add @nxgt/ai-core @nxgt/ai-anthropic zod
```

Imports carry no file extension, so consumers need `"moduleResolution": "bundler"` in your `tsconfig.json`.

## Quick start

```ts
import { z } from 'zod';
import { defineTool, runAgent } from '@nxgt/ai-core';
import { anthropic } from '@nxgt/ai-anthropic';

const weather = defineTool({
	name: 'weather',
	description: 'Current temperature in a city',
	input: z.object({ city: z.string() }),
	execute: async ({ city }) => ({ city, degrees: 18 }),
});

const run = runAgent({
	model: anthropic({
		apiKey: process.env.ANTHROPIC_API_KEY!,
		model: 'claude-sonnet-4-5',
	}),
	messages: [
		{ role: 'user', parts: [{ type: 'text', text: 'Weather in Lyon?' }] },
	],
	tools: [weather],
	maxSteps: 5,
});
for await (const event of run) {
	if (event.type === 'text-delta') process.stdout.write(event.text);
}
```

## Contributing

See [AGENTS.md](AGENTS.md). Run `bun install`, then `bunx biome ci`, `bun run build`, `bun run typecheck`, `bun run test` and `bun run verify:artifacts`.
