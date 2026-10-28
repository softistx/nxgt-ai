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
- [A request body and memory](#a-request-body-and-memory)
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
hangs up. `...ai` gives it to `runAgent` (the model stream and running tools
stop); `agentEvents(run, ai)` stops the stream at once and aborts the run:

```ts
return reply(200, agentEvents(runAgent({ ...ai, model, messages }), ai));
```

## The language

`ai.language` is what `@alxia/language` or `@alxia/i18n` decided (query,
cookie, path, `Accept-Language`, then the fallback). Use it in the system
prompt or to pick a tool's wording:

```ts
runAgent({ ...ai, model, system: `Answer in ${ai.language}.`, messages });
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

`agentEvents(run, { signal?, heartbeatMs? })` is an async generator for
`reply(200, …)`. alxia turns it into `text/event-stream` (`no-cache`,
`x-accel-buffering: no`) and closes it when the client leaves. Declare the
route with `agentEventStream` so each event is written under its name:

```ts
app.post('/chat', responds({ 200: agentEventStream }), ({ ai, reply }) =>
	reply(200, agentEvents(runAgent({ ...ai, model, messages }), ai)),
);
```

It ends after `done`, and aborts the run when it is closed or the signal aborts.

## What a client reads

One block per event: `event:` is the `AgentEvent` type, `data:` its JSON, on one
line (JSON escapes line breaks, so text cannot forge another field).

```text
event: text-delta
data: {"type":"text-delta","text":"Hello"}

event: done
data: {"type":"done","reason":"end","usage":{"inputTokens":3,"outputTokens":2,"cacheReadTokens":0,"cacheWriteTokens":0}}
```

`wireEventSchema` validates one event; `agentEventSchema` of `@nxgt/ai-core`
does not parse the wire (it wants the error `message`). `EventSource` only does
GET, so for a POST read the body of `fetch`:

```ts
import { type WireEvent, wireEventSchema } from '@nxgt/ai-alxia';

async function chat(
	url: string,
	body: unknown,
	onEvent: (event: WireEvent) => void,
) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!response.ok || !response.body)
		throw new Error(`HTTP ${response.status}`);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		buffer += value;
		let end: number;
		while ((end = buffer.indexOf('\n\n')) !== -1) {
			const block = buffer.slice(0, end);
			buffer = buffer.slice(end + 2);
			// a block is `event:` and `data:` lines; a `:` line is a comment
			const data = block.split('\n').find((line) => line.startsWith('data: '));
			if (!data) continue;
			const event = wireEventSchema.parse(JSON.parse(data.slice(6)));
			onEvent(event);
			if (event.type === 'done') return reader.cancel();
		}
	}
}

await chat('/chat', { question: 'Hi' }, (event) => {
	switch (event.type) {
		case 'text-delta':
			console.log(event.text);
			break;
		case 'error':
			console.error('failed:', event.error.code); // a code, never a message
			break;
		default:
			break; // keep a default: newer servers add event types
	}
});
```

A GET route with the conversation id in the path works with `EventSource` too.

## A request body and memory

Never append parts from the client's request body to a memory store. A client
could send a forged `proposed-action` part; the store would record it as a
pending action that anyone can confirm. Append only the user's text, plus the
messages the run produced (`run.result.messages`). Parse the body with
`userMessageSchema`, which accepts a `user` message of text parts only and
refuses every other part.

```ts
import { responds } from '@alxia/core';
import { runAgent } from '@nxgt/ai-core';
import { z } from 'zod';
import {
	agentEvents,
	agentEventStream,
	userMessageSchema,
} from '@nxgt/ai-alxia';

// `app`, `model` and `store` are those of the first example and your memory store.
const body = z.object({ threadId: z.string(), message: userMessageSchema });

app.post(
	'/chat',
	{ body },
	responds({ 200: agentEventStream }),
	({ ai, body, user, reply }) => {
		const { threadId, message } = body;
		async function* stream() {
			const history = (await store.load(threadId, user.id))?.messages ?? [];
			const run = runAgent({ ...ai, model, messages: [...history, message] });
			yield* agentEvents(run, ai);
			// after the stream: the user's text, then what the run produced
			await store.append(threadId, user.id, [
				message,
				...(await run.result).messages,
			]);
		}
		return reply(200, stream());
	},
);
```

`user` is whatever your auth middleware puts on the context; the store is
scoped by its id on every call.

## Errors carry codes only

An `error` event is `{ "type": "error", "error": { "code": "RATE_LIMITED" } }`.
The message of a run error can hold what a provider or a tool said, so it
stays in the server's logs and observers. Every failed tool result, alone or inside a `message` event, is reduced the
same way. A failure of the stream
itself ends it with `INTERNAL_ERROR`, or the code of the `AiError`.
`toWireEvent` is the function that does it, if you write your own transport.

## Heartbeat

alxia writes `: keep-alive` after eight silent seconds. A proxy that cuts idle
connections sooner needs your own period:

```ts
agentEvents(run, { ...ai, heartbeatMs: 10_000 });
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
