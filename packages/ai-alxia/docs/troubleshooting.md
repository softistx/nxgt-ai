# Troubleshooting

- [A compile error on `.use(aiRequest())`](#a-compile-error-on-useairequest)
- [`ai.language` is always the fallback](#ailanguage-is-always-the-fallback)
- [The run goes on after the client left](#the-run-goes-on-after-the-client-left)
- [The client sees no error message](#the-client-sees-no-error-message)
- [`agentEventSchema` fails on an event](#agenteventschema-fails-on-an-event)
- [The events arrive all at once](#the-events-arrive-all-at-once)
- [The connection closes while the model thinks](#the-connection-closes-while-the-model-thinks)
- [`EventSource` cannot call my POST route](#eventsource-cannot-call-my-post-route)

## A compile error on `.use(aiRequest())`

**When:** TypeScript says the middleware requires `language`.
**Why:** `aiRequest` reads `language` from the context, and nothing before it adds it.
**Fix:** use `@alxia/language` (or `@alxia/i18n`) first.

```ts
alxia()
	.use(language({ supported: ['en'] as const, fallback: 'en' }))
	.use(aiRequest());
```

## `ai.language` is always the fallback

**When:** `?lang=fr` or `Accept-Language: fr` still gives the fallback.
**Why:** the language middleware decides, not `aiRequest`: the language is not in `supported`, or its `order` leaves the source out.
**Fix:** check `supported` and `order` of the language middleware; `languageSource` says which source decided.

## The run goes on after the client left

**When:** the model keeps streaming, or tools keep running, after a disconnect.
**Why:** the run was not given the request's signal, or `agentEvents` was not (a run waiting on a model is only seen by the signal).
**Fix:** write the pair: spread `ai` into `runAgent` and pass `ai` to `agentEvents`.

```ts
reply(200, agentEvents(runAgent({ ...ai, model, messages }), ai));
```

## The client sees no error message

**When:** an `error` event is `{ "code": "MODEL_ERROR" }` with nothing else, or `INTERNAL_ERROR`.
**Why:** by design: messages can hold provider or tool details. `INTERNAL_ERROR` means the stream itself failed with something that is not an `AiError` (a bug or an unexpected exception on the server).
**Fix:** map the code to your own text on the client; for the cause, check the server logs or an observer (`onRunEnd`'s `error`).

## `agentEventSchema` fails on an event

**When:** `agentEventSchema.parse` from `@nxgt/ai-core` rejects an `error` event or a failed tool result.
**Why:** that schema requires `message`; the wire has none.
**Fix:** parse with `wireEventSchema` from `@nxgt/ai-alxia`.

## The events arrive all at once

**When:** the client gets the whole answer at the end.
**Why:** a proxy buffers the response, or the client buffers the body. alxia sends `x-accel-buffering: no` for nginx; other proxies have their own switch. Compression middleware can buffer too.
**Fix:** disable buffering for the route in the proxy, and keep a compression middleware off `text/event-stream`.

## The connection closes while the model thinks

**When:** the stream drops after some seconds of silence, before any event.
**Why:** a proxy or load balancer cuts idle connections, more often than alxia's 8 s keep-alive.
**Fix:** `agentEvents(run, { ...ai, heartbeatMs: 5000 })`, below the proxy's idle timeout.

## `EventSource` cannot call my POST route

**When:** `new EventSource('/chat')` gets a 404 or 405.
**Why:** `EventSource` sends GET and no body.
**Fix:** read `fetch(...).body` as a stream, or serve a GET route that takes the conversation id.
