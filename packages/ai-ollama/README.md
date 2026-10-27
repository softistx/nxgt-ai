# @nxgt/ai-ollama

A local [Ollama](https://ollama.com) server as an `@nxgt/ai-core`
`ModelAdapter`, on Bun `fetch` with no third-party client.
Peer: `@nxgt/ai-core`.

```ts
import { generate } from '@nxgt/ai-core';
import { ollama } from '@nxgt/ai-ollama';

const model = ollama({ model: 'llama3.2' }); // after `ollama pull llama3.2`

const { message, usage } = await generate(model, {
	system: [{ text: 'Answer in one sentence.' }],
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'What is Bun?' }] }],
});
```

Calls stream (`/api/chat`, NDJSON): text and thinking arrive as deltas, tool
calls arrive whole, and `usage` comes from `prompt_eval_count` and
`eval_count`. **Tool support varies by model**: a model without it answers
in text or fails with an `OllamaError`; check the tools filter on ollama.com.

Failures are `OllamaError`s (an `AiError`): `error.kind` tells a server that
is not running (`unreachable`) from a missing model (`model-not-found`).
There are no retries; a local server that refuses a connection will not
recover within a backoff.

`bun run smoke:ollama` in the repository tries it against your server
(local only).

## Install

```sh
bun add @nxgt/ai-ollama @nxgt/ai-core
```

Requires `"moduleResolution": "bundler"`. See the [guide](docs/guide/ollama.md).

## Documentation

[docs/](docs/README.md): guides, [troubleshooting](docs/troubleshooting.md) and the [roadmap](docs/roadmap.md).
