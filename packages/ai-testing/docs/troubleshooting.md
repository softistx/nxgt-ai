# Troubleshooting

- [`fakeModel script has no turn N`](#fakemodel-script-has-no-turn-n)
- [Injected errors](#injected-errors)
- [`collect` hangs or returns too little](#collect-hangs-or-returns-too-little)
- [`Expected tool calls ..., got ...`](#expected-tool-calls--got-)
- [Request recording](#request-recording)

## `fakeModel script has no turn N`

**When:** the run makes more model calls than the array script has turns (`AiError`, code `MODEL_ERROR`).
**Why:** the agent loop calls the model once per step: a tool call needs a turn for the tool-use answer and another for the final text.
**Fix:**

```ts
const model = fakeModel([
	{ toolCalls: [{ name: 'find_order', input: { id: '1' } }] }, // call 0
	{ text: 'Order 1 shipped.' }, // call 1
]);
```

If the number of calls varies, use a function script: `fakeModel((req, i) => ({ text: 'ok' }))`.

## Injected errors

**When:** a turn with `error` throws it before any event; the run ends with `reason: 'error'`.
**Why:** `error` must be an `AiError`, thrown by `stream` after `delayMs`. It is the whole turn: `text` and `toolCalls` of that turn are not emitted.
**Fix:**

```ts
import { AiError } from '@nxgt/ai-core';
import { fakeModel } from '@nxgt/ai-testing';

fakeModel([{ error: new AiError('RATE_LIMITED', 'slow down') }]);
```

To test recovery, put the error turn first and the answer in the next turn of a new run.

## `collect` hangs or returns too little

**When:** `await collect(run)` resolves with an empty array, or waits.
**Why:** `collect` drains an async iterable once, so a run you already iterated yields nothing the second time; and a turn with a long `delayMs` makes it wait until the delay ends or the signal aborts.
**Fix:** collect once, and abort through the signal, not by breaking out.

```ts
const events = await collect(runAgent({ model, messages, tools }));
```

## `Expected tool calls ..., got ...`

**When:** the tool-call assertion fails.
**Why:** it compares the names, in order, and the inputs by JSON when the expectation gives an `input` (so key order matters). Calls of every step are counted.
**Fix:** print the "got" side and align the expectation, or leave out `input` to match on names only.

## Request recording

**When:** `model.requests` is shorter than you expect, or an old request seems unchanged.
**Why:** each `stream` call adds one entry with a copy of the message array; messages added later are not in it. Aborted-before-start runs still record the request.
**Fix:** assert on `model.requests[i].messages` after the run, and create one `fakeModel` per test.
