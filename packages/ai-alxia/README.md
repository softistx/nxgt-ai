# @nxgt/ai-alxia

[alxia](https://www.npmjs.com/package/@alxia/core) glue for
[`@nxgt/ai-core`](../ai-core). `aiRequest` is a middleware that gives a handler
what `runAgent` needs from the request (an abort signal, the request language,
the app's observers). `agentEvents` streams a run's events as Server-Sent
Events, written by alxia's own SSE support. Peers: `@alxia/core`,
`@nxgt/ai-core`, `zod`. The language comes from `@alxia/language` or
`@alxia/i18n`, which you already use.

```sh
bun add @nxgt/ai-alxia @alxia/core @nxgt/ai-core zod
```

The example below uses `fakeModel` from `@nxgt/ai-testing`, a separate install
(`bun add -d @nxgt/ai-testing`); in production give `runAgent` a real model.

```ts
import { alxia, responds } from '@alxia/core';
import { language } from '@alxia/language';
import { runAgent } from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';
import { agentEvents, agentEventStream, aiRequest } from '@nxgt/ai-alxia';

// A scripted model for the example; use @nxgt/ai-anthropic or @nxgt/ai-ollama in production.
const model = fakeModel([{ text: 'Hello!' }]);

const app = alxia()
	.use(language({ supported: ['en', 'fr'] as const, fallback: 'en' }))
	// observers: [aiTelemetry()] from @nxgt/ai-telemetry, for every run of the app
	.use(aiRequest({ observers: [] }))
	.post('/chat', responds({ 200: agentEventStream }), ({ ai, reply }) => {
		const messages = [
			{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] },
		];
		// ai = { signal, language, observers }
		const run = runAgent({
			model,
			system: `Answer in ${ai.language}.`,
			messages,
			...ai,
		});
		return reply(200, agentEvents(run, { ...ai, heartbeatMs: 15_000 }));
	});

app.listen(3000);
```

```sh
curl -N -X POST 'localhost:3000/chat?lang=fr'
# event: step-start
# data: {"type":"step-start","step":1,"runId":"..."}
#
# event: text-delta
# data: {"type":"text-delta","text":"Hello!"}
# ...
# event: done
# data: {"type":"done","reason":"end","usage":{...}}
```

Imports carry no file extension, so consumers need `"moduleResolution": "bundler"`.

## Exports

| Export                                  | What it is                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `aiRequest(options?)`                   | The middleware: puts `ctx.ai = { signal, language, observers }`; `options.observers` are given to every run |
| `AiRequest`, `AiRequestOptions`         | The type of `ctx.ai` and of the options                                                                     |
| `agentEvents(run, options?)`            | An async generator of SSE items for `reply(200, …)`; `options.signal` and `options.heartbeatMs`             |
| `AgentEventsOptions`, `AgentStreamItem` | Its options and what it yields: a named event or a comment                                                  |
| `agentEventStream`                      | The response schema (`eventStream`) of the route: one named event per `AgentEvent` type                     |
| `toWireEvent(event)`, `WireEvent`       | The event as a client reads it: errors reduced to a code                                                    |
| `INTERNAL_ERROR`                        | The code of a failure that is not an `AiError`                                                              |

## Traps

- `aiRequest` reads `language` from the context: put `@alxia/language` or `@alxia/i18n` before it, or alxia refuses the chain at compile time.
- Always write the pair `agentEvents(runAgent({ ...ai, … }), ai)`: spread `ai` into `runAgent` **and** pass it (its `signal`) to `agentEvents`. A run waiting on the model is only stopped on a disconnect through the signal.
- The wire has no error messages: an `error` event and every failed tool result (alone or inside a `message` event) carry `{ code }` only. `agentEventSchema` of `@nxgt/ai-core` does not parse the wire; validate with `wireEventSchema` (a [client example](docs/guide/request-and-sse.md#what-a-client-reads)).
- `data:` is JSON on one line: a line break in text is escaped (`\n`), never a second `data:` line. alxia writes the frames, the `content-type`, `cache-control: no-cache` and `x-accel-buffering: no`.
- alxia already writes `: keep-alive` every 8 s of silence. `heartbeatMs` adds a `: heartbeat` comment of your own period, for a proxy with a shorter timeout.
- The stream ends after the `done` event, and after an `error` event the run did not follow with `done` (a failure of the stream itself).
- Headers and status are gone after the first event: a failure after it is an `error` event, never a 500.

More: [guide](docs/guide/request-and-sse.md), [troubleshooting](docs/troubleshooting.md), [roadmap](docs/roadmap.md).
