# Testing agents

## fakeModel

`fakeModel(script)` returns a `ModelAdapter` (`provider: 'fake'`). The script is
an array of `Turn`s, turn `i` answering model call `i`, or a function
`(req, index) => Turn`. The same script always gives the same events.

| `Turn` field | Effect                                                            |
| ------------ | ----------------------------------------------------------------- |
| `text`       | `text-delta` events                                               |
| `thinking`   | `thinking-delta` events, before the text                          |
| `toolCalls`  | `tool-call` events with ids `call_<turn>_<index>`                 |
| `usage`      | one `usage` event                                                 |
| `finish`     | the finish reason; default `tool-use` with tool calls, else `end` |
| `chunk`      | split text and thinking into deltas of this many characters       |
| `error`      | an `AiError` thrown by `stream`, before any event                 |
| `delayMs`    | wait before the turn; an abort during the wait ends the stream    |

```ts
const model = fakeModel((req, i) =>
	i === 0
		? { toolCalls: [{ name: 'search', input: { q: 'x' } }] }
		: { text: 'done' },
);
```

A call past the end of an array script throws `AiError` `MODEL_ERROR`.

## Requests

`model.requests` holds a copy of every `ModelRequest` received, in order, so you
can check the messages, `tools` and options the agent sent.

## Errors and abort

```ts
const failing = fakeModel([
	{ error: new AiError('RATE_LIMITED', 'slow down') },
]);

const slow = fakeModel([{ text: 'late', delayMs: 10_000 }]);
const ac = new AbortController();
setTimeout(() => ac.abort(), 5); // the stream ends, as the model port requires
```

## collect and assertions

`collect(run)` drains an `AsyncIterable` of events, or any object with an
`events` iterable such as an agent run, into an array. `toolCallsOf(events)`
lists `{ name, input }`; `textOf(events)` joins the text deltas;
`expectToolCalls(events, [{ name, input? }])` throws when the calls differ
(inputs compared as JSON; omit `input` to check the name only).
