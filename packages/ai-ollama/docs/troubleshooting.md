# Troubleshooting

Every failure is an `OllamaError`, an `AiError` with a `kind` and, for HTTP
failures, a `status`. Unlike the hosted adapters it does not retry.

- [Connection](#connection): `Cannot reach Ollama`
- [Model](#model): `model not found`, tools and thinking
- [HTTP errors](#http-errors)
- [Stream](#stream)

## Connection

### `Cannot reach Ollama at http://localhost:11434: is \`ollama serve\` running?`

**When:** the first call. `kind: 'unreachable'`, code `MODEL_ERROR`.
**Why:** the server is not running, or `baseUrl` points to the wrong host or port (in a container, `localhost` is the container).
**Fix:**

```ts
import { ollama } from '@nxgt/ai-ollama';

const model = ollama({ model: 'llama3.1', baseUrl: 'http://ollama:11434' });
```

Start it with `ollama serve`. The original error is in `error.cause`.

## Model

### `Ollama API 404: model "..." not found (run \`ollama pull <model>\`)`

**When:** the model name is not on the server. `kind: 'model-not-found'`, code `MODEL_ERROR`.
**Why:** it was never pulled, or the tag differs (`llama3.1` and `llama3.1:70b` are different).
**Fix:**

```sh
ollama pull llama3.1
```

### A model answers in text instead of calling a tool, or fails when tools are sent

**When:** an agent with `tools` on a model that does not support tool calls. The error is usually an `Ollama API 400: ... does not support tools`.
**Why:** tool support varies by model; the server decides, not the adapter.
**Fix:** pick a model with the tools filter on ollama.com.

```ts
ollama({ model: 'llama3.1' }); // a tools-capable model
```

### `Ollama API 400: ... does not support thinking`

**When:** a request with `thinking` (or `think: true`) on a model that has no thinking mode. `kind: 'bad-request'`.
**Why:** thinking is a per-model capability.
**Fix:** drop `thinking` from the request, or use a model that has it.

### A long prompt is cut or the model forgets the start of the conversation

**When:** a long history or a large tool result, and the model ignores early messages. No error is raised.
**Why:** Ollama truncates the prompt to the context window (`num_ctx`), which defaults to a small value.
**Fix:** raise it with `numCtx`, or per request with `providerOptions.options.num_ctx`. Other `options` (temperature, `num_predict`) are kept.

```ts
ollama({ model: 'llama3.2', numCtx: 16384 });
```

## HTTP errors

### `Ollama API 401: ...` (also 403)

**When:** calling a hosted or proxied Ollama. `kind: 'auth'`, code `AUTHENTICATION`.
**Why:** a gateway in front of the server refused the call.
**Fix:** the adapter sends no credentials of its own. Wrap `fetch` (the `fetch` option) to add the header the gateway expects, or call the server directly.

```ts
ollama({
	model,
	baseUrl,
	fetch: (url, init) =>
		fetch(url, {
			...init,
			headers: { ...init?.headers, authorization: `Bearer ${token}` },
		}),
});
```

### `Ollama API 429: ...`

**When:** a proxy rate-limits you. `kind: 'rate-limited'`, code `RATE_LIMITED`.
**Why:** not retried here.
**Fix:** back off in the caller.

### `Ollama API 500: ...` (any 5xx)

**When:** the server fails, often out of memory loading a large model. `kind: 'provider'`.
**Why:** the text after the status is the server's own message.
**Fix:** use a smaller model or quantisation.

### `Ollama API 400: ...` (other 4xx)

**When:** a bad request. `kind: 'bad-request'`.
**Why:** read the text after the status.
**Fix:** correct the request.

## Stream

### `Ollama error: <message>`

**When:** mid-stream, when the server sends an `{ "error": "..." }` line. `kind: 'provider'`.
**Why:** the model failed after the answer started.
**Fix:** retry the call; the text says why.

### `Ollama closed the stream before the final \`done\` line`

**When:** mid-answer. `kind: 'protocol'`.
**Why:** the server stopped, crashed, or a proxy cut the connection.
**Fix:** check `ollama serve` logs; retry.

### `Ollama sent a line that is not JSON: ...`

**When:** reading the stream. `kind: 'protocol'`.
**Why:** `baseUrl` is not an Ollama server (a web page, a proxy error body).
**Fix:** point `baseUrl` at the Ollama port.
