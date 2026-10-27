# The Ollama adapter

`ollama(options)` returns a `ModelAdapter` (`provider: 'ollama'`) that calls
`POST {baseUrl}/api/chat` with `stream: true` on Bun `fetch`. Pass it to
`generate` or `runAgent` like any other model.

```ts
import { ollama } from '@nxgt/ai-ollama';

const model = ollama({
	model: 'qwen3',
	baseUrl: 'http://gpu-box:11434',
	keepAlive: '30m',
	think: true,
});
```

## Options

| Option      | Default                  | Meaning                                                             |
| ----------- | ------------------------ | ------------------------------------------------------------------- |
| `model`     | required                 | a model already pulled (`ollama pull <model>`)                      |
| `baseUrl`   | `http://localhost:11434` | another host or a proxy; a trailing slash is ignored                |
| `keepAlive` | server default (`5m`)    | how long the model stays loaded: `'10m'`, seconds, `-1`, `0`        |
| `think`     | on when a request asks   | `true`, `false` or a level (`'low'`, `'medium'`, `'high'`, `'max'`) |
| `fetch`     | global `fetch`           | replace it in tests                                                 |
| `newId`     | `call_<uuid>`            | replace the tool call id generator in tests                         |

## What is sent

| Core                       | Ollama                                                                       |
| -------------------------- | ---------------------------------------------------------------------------- |
| `system` blocks            | one `system` message, blocks joined by a blank line                          |
| `maxTokens`, `temperature` | `options.num_predict`, `options.temperature`                                 |
| tool specs                 | `tools: [{ type: 'function', function: { name, description, parameters } }]` |
| `tool-call` parts          | `tool_calls: [{ function: { name, arguments } }]`                            |
| `tool-result` parts        | one `tool` message each, with `tool_name`; errors as JSON                    |
| `thinking` part            | the assistant message's `thinking`                                           |
| `cache`                    | ignored: Ollama keeps its own KV cache                                       |
| `thinking` request         | `think: true` when the adapter's `think` is unset                            |
| `providerOptions`          | merged into the body, for `format`, `options.seed`, ...                      |

Ollama has no thinking token budget, so `budgetTokens` is ignored.

## What comes back

| Ollama line            | Event                                                |
| ---------------------- | ---------------------------------------------------- |
| `message.thinking`     | `thinking-delta` (no signature: Ollama has none)     |
| `message.content`      | `text-delta`                                         |
| `message.tool_calls[]` | `tool-call`, with a generated id (Ollama gives none) |
| `done: true`           | `usage`, then `finish`                               |

`finish` is `tool-use` when the call had tool calls, `max-tokens` for
`done_reason: 'length'`, else `end`. The parser accepts chunks cut at any byte,
even inside a UTF-8 character.

## Tool support varies by model

Ollama passes `tools` to the model's template. A model whose template has no
tool section answers `400 ... does not support tools`, which is an
`OllamaError` of kind `bad-request`. Small models may also answer in text
instead of calling the tool. Try `bun run smoke:ollama` with your model.

## Errors

| `kind`            | When                                        | `code`           |
| ----------------- | ------------------------------------------- | ---------------- |
| `unreachable`     | connection refused, DNS, no route           | `MODEL_ERROR`    |
| `model-not-found` | 404 `model '...' not found`                 | `MODEL_ERROR`    |
| `auth`            | 401, 403 (a proxy in front of Ollama)       | `AUTHENTICATION` |
| `rate-limited`    | 429                                         | `RATE_LIMITED`   |
| `provider`        | 5xx, or an `{"error"}` line mid-stream      | `MODEL_ERROR`    |
| `bad-request`     | other 4xx (such as a model without tools)   | `MODEL_ERROR`    |
| `protocol`        | a line that is not JSON, or no final `done` | `MODEL_ERROR`    |

```ts
import { OllamaError } from '@nxgt/ai-ollama';

try {
	await generate(model, { messages });
} catch (error) {
	if (error instanceof OllamaError && error.kind === 'unreachable')
		console.error('Start Ollama: ollama serve');
}
```

There are no retries. Aborting the `AbortSignal` ends the stream without an
error and cancels the HTTP request.

## Testing

Pass a fake `fetch` that returns an NDJSON `Response`:

```ts
const lines = [
	{ message: { content: 'Hi' }, done: false },
	{ message: { content: '' }, done: true, done_reason: 'stop', eval_count: 1 },
];
const body = lines.map((l) => JSON.stringify(l)).join('\n');
const model = ollama({
	model: 'test',
	fetch: (async () => new Response(body)) as unknown as typeof fetch,
});
```
