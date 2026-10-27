# Proposed actions

A tool defined with `confirm: true` changes data. The agent loop never runs it:
the user decides first.

## What the loop does

When the model calls a confirm tool with a valid input, `runAgent`:

1. emits `{ type: 'proposed-action', action }` (a `ProposedActionPart` with
   `id` = the call id, `tool`, `input` and `expiresAt`);
2. adds the same part to the tool message, after the tool results;
3. answers the model with a tool result `{ status: 'pending', actionId }`, so it
   can tell the user it is waiting for a confirmation.

An invalid input is an ordinary `INVALID_TOOL_INPUT` result the model can
correct; nothing is proposed. The expiry is `now() + proposalTtlMs`
(default one hour); pass `now` to `runAgent` to fix the clock in tests.

## Confirming

```ts
import {
	rejectAction,
	runConfirmedAction,
	toProposedAction,
} from '@nxgt/ai-core';

const action = toProposedAction(part); // status 'pending'
// store it, show it, wait for the user...
const done = await runConfirmedAction(action, tools, { context, signal });
// done.status is 'confirmed' (done.result.output) or 'failed' (done.result.error)
```

`ProposedAction` is `{ id, tool, input, status, expiresAt, result?, summary? }`
with `status` one of `pending`, `confirmed`, `rejected`, `expired`, `failed`.

`runConfirmedAction(action, tools, ctx, { now })` re-validates the input and
throws, without running anything, an `AiError`:

| code                 | when                                     |
| -------------------- | ---------------------------------------- |
| `ACTION_NOT_PENDING` | the status is not `pending`              |
| `ACTION_EXPIRED`     | `now()` is at or after `expiresAt`       |
| `UNKNOWN_TOOL`       | no tool in `tools` has the action's name |
| `INVALID_TOOL_INPUT` | the input no longer validates            |

Otherwise it runs the tool and returns a **new** action; it does not mutate its
argument. "Exactly once" is the caller's: save the returned action (with a
compare-and-set on the `pending` status in a shared store) so a second click
meets `ACTION_NOT_PENDING`. An abort rejects and leaves the decision to you.

`rejectAction(action)` returns the action `rejected`, with the same two checks.

## estimateTokens

`estimateTokens(text | messages)` returns `ceil(characters / 4)`, counting the
text, thinking, tool calls and results and proposed actions of the messages.
It is a heuristic with no tokenizer (about 30% off for prose, low for code and
CJK). To size a context, take the last `Usage.inputTokens` the provider
reported and add `estimateTokens` of the messages added since.
