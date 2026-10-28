# Request and SSE

An agent behind an alxia route needs three things from the request (a signal
that fires when the client leaves, its language, the app's observers) and a way
to stream events. `aiRequest` gives the first three, `agentEvents` the stream.

- [aiRequest](#airequest)
- [The abort signal](#the-abort-signal)
- [The language](#the-language)
- [Observers](#observers)
- [agentEvents](#agentevents)
- [What a client reads](#what-a-client-reads)
- [Errors carry codes only](#errors-carry-codes-only)
- [Heartbeat](#heartbeat)
- [Test your route](#test-your-route)

## aiRequest

```ts
import { alxia } from '@alxia/core';
import { language } from '@alxia/language';
import { aiRequest } from '@nxgt/ai-alxia';

const app = alxia()
	.use(language({ supported: ['en', 'fr'] as const, fallback: 'en' }))
	.use(aiRequest({ observers: [] }))
	.get('/who', ({ ai, reply }) => reply(200, ai.language));
```

After it, every handler reads `ai`: `{ signal, language, observers }`. The
three keys are those of `runAgent`'s options, so `...ai` spreads them.

## The abort signal

`ai.signal` is the request's own signal, which alxia aborts when the client
hangs up. Give it to `runAgent` and the model stream and running tools stop.
Give it to `agentEvents` too, so the stream stops at once:

```ts
const run = runAgent({ model, messages, ...ai });
return reply(200, agentEvents(run, { signal: ai.signal }));
```

## The language

`aiRequest` does not read the language itself: `@alxia/language` or
`@alxia/i18n` does (query, cookie, path, `Accept-Language`, then the
fallback), and `ai.language` is what they decided. Use it in the system
prompt, or to pick a tool's wording:

```ts
const run = runAgent({
	model,
	system: `Answer in ${ai.language}.`,
	messages,
	...ai,
});
```

## Observers

`aiRequest({ observers })` holds the observers once for the app. Each request
gets the same array, so an observer serving concurrent runs must key by `runId`
(the `AgentObserver` hooks all receive it).

```ts
import { aiTelemetry } from '@nxgt/ai-telemetry';

alxia().use(aiRequest({ observers: [aiTelemetry()] }));
```

## agentEvents

`agentEvents(run, { signal?, heartbeatMs? })` is an async generator. alxia
turns an async iterable reply into `text/event-stream`, with the headers
`content-type: text/event-stream`, `cache-control: no-cache` and
`x-accel-buffering: no`, and closes the generator when the client leaves.
Declare the route with `agentEventStream` so each event is written under its
name:

```ts
app.post('/chat', responds({ 200: agentEventStream }), ({ ai, reply }) =>
	reply(200, agentEvents(runAgent({ model, messages, ...ai }), ai)),
);
```

(`ai` also has `signal`, so passing it as the options is enough.)

The generator ends after `done`. When it is closed, or `signal` aborts, it
aborts the run.

## What a client reads

One block per event: `event:` is the `AgentEvent` type, `data:` its JSON.

```text
event: text-delta
data: {"type":"text-delta","text":"Hello"}

event: done
data: {"type":"done","reason":"end","usage":{"inputTokens":3,"outputTokens":2,"cacheReadTokens":0,"cacheWriteTokens":0}}
```

JSON escapes line breaks, so text with several lines stays on one `data:` line
and cannot forge another field. In a browser, `EventSource` only does GET; for
a POST read the body of `fetch` as a stream, or use a GET route with the
conversation id in the path.

## Errors carry codes only

An `error` event is `{ "type": "error", "error": { "code": "RATE_LIMITED" } }`.
The message of a run error can hold what a provider or a tool said, so it
stays in the server's logs and observers. The same holds for a failed
`tool-result` (`code` only, no `message` or `issues`). A failure of the stream
itself ends it with `INTERNAL_ERROR`, or the code of the `AiError`.
`toWireEvent` is the function that does it, if you write your own transport.

## Heartbeat

alxia writes `: keep-alive` after eight silent seconds. A proxy that cuts idle
connections sooner needs your own period:

```ts
agentEvents(run, { signal: ai.signal, heartbeatMs: 10_000 });
```

A comment is a line `EventSource` skips; it is not an event and moves no id.

## Test your route

```ts
const response = await app.request('/chat?lang=fr', { method: 'POST' });
const body = await response.text();
expect(body).toContain('event: done');
```

Abort test: pass `{ signal }` to `app.request`, read one chunk, call
`controller.abort()`, and check that an observer's `onRunEnd` saw `aborted`.
