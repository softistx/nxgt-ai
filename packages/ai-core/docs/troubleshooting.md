# Troubleshooting

Every error here is an `AiError` with a `code`. Some are thrown; others are
reported on `AgentResult.error`, on the `error` event, or in a tool result.

- [Defining tools](#defining-tools): `INVALID_TOOL_DEFINITION`
- [Tool calls](#tool-calls): `INVALID_TOOL_INPUT`, `INVALID_TOOL_OUTPUT`, `TOOL_FAILED`, `UNKNOWN_TOOL`
- [Run limits](#run-limits): `MAX_STEPS`, `BUDGET_EXCEEDED`, `ABORTED`, a tool that outlives the abort, a run that goes on after `break`
- [Model](#model): `MODEL_ERROR`, `RATE_LIMITED`, `AUTHENTICATION`
- [Proposed actions](#proposed-actions): `ACTION_NOT_PENDING`, `ACTION_EXPIRED`

## Defining tools

### `Tool name "..." is invalid: use 1 to 64 letters, digits, "_" or "-".`

**When:** calling `defineTool` or `jsonSchemaTool` (code `INVALID_TOOL_DEFINITION`, thrown).
**Why:** providers accept only `[a-zA-Z0-9_-]{1,64}` as a tool name, so a space, a dot or a long name is refused before it reaches a model.
**Fix:**

```ts
defineTool({
	name: 'find_order',
	description: 'Find an order by id',
	input,
	execute,
});
```

### `Tool "..." needs a description: the model reads it.`

**When:** calling `defineTool` or `jsonSchemaTool` with an empty or blank description (`INVALID_TOOL_DEFINITION`, thrown).
**Why:** the description is the only thing that tells the model when to call the tool.
**Fix:**

```ts
defineTool({
	name: 'find_order',
	description: 'Find one order by its id.',
	input,
	execute,
});
```

### `Tool "...": the input schema must describe an object`

**When:** `jsonSchemaTool` with a schema whose `type` is not `"object"`, (`INVALID_TOOL_DEFINITION`, thrown). The full text ends `(type "object"), not <type>.`.
**Why:** providers require a tool's input to be an object.
**Fix:**

```ts
inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
```

## Tool calls

These come back as a tool result with `isError: true` (the model sees them and can retry); they do not stop the run.

### `Invalid input for tool "..."`

**When:** the model calls a tool with arguments that fail the `input` schema (`INVALID_TOOL_INPUT`). `error.issues` lists each problem by dotted path. `runConfirmedAction` throws the same error when a stored action no longer validates.
**Why:** the model sent a wrong or missing field, or the schema changed after the action was proposed.
**Fix:** describe each field so the model gets it right, and read the issues in a test.

```ts
input: z.object({ id: z.string().describe('Order id, e.g. "ord_123"') }),
```

### `Tool "..." returned an invalid output.`

**When:** a tool with an `output` schema returns a value that does not match it (`INVALID_TOOL_OUTPUT`).
**Why:** `execute` returns something other than what the schema promises; `error.issues` locates it.
**Fix:** return the declared shape, or relax `output`.

```ts
execute: async ({ id }) => ({ id, status: 'shipped' }), // matches output: z.object({ id, status })
```

### `Tool "..." failed: <reason>`

**When:** a tool's `execute` throws (`TOOL_FAILED`); `error.cause` is the original error. The bare `Tool "..." failed.` is the same code when the throw was unexpected during the run.
**Why:** an exception in your code. The reason is sent to the model, so it must be safe to show.
**Fix:** throw an `AiError` (or a clear message) for expected failures, and return data for the rest.

```ts
execute: async ({ id }) => {
	const order = await find(id);
	if (!order) throw new Error(`No order ${id}`);
	return order;
},
```

### `No tool named "..."`

**When:** the model calls a tool that is not in `tools` (`UNKNOWN_TOOL`), or `runConfirmedAction` gets an action whose tool is missing from the list you pass.
**Why:** the model invented a name, or the tool list differs between the run and the confirmation.
**Fix:** pass the same tools to both.

```ts
const tools = [findOrder, cancelOrder];
runAgent({ model, messages, tools });
await runConfirmedAction(action, tools);
```

## Run limits

These end the run: `result.reason` is `max-steps`, `budget` or `aborted`, and `result.error` carries the code.

### `The run reached its limit of N model calls.`

**When:** the run needs more than `maxSteps` model calls (default 8) (`MAX_STEPS`, `reason: 'max-steps'`).
**Why:** each model call that asks for tools adds a step; a loop of tool calls, or a long task, hits the cap.
**Fix:**

```ts
runAgent({ model, messages, tools, maxSteps: 20 });
```

If the model keeps calling the same tool, fix the tool's result or description instead of raising the limit.

### `The call was cut off (the step ended max-tokens) and did not run.`

**When:** a step ends `max-tokens`, `end` or `refusal` while the model also sent complete tool calls. The result is a `MODEL_ERROR` tool result, not a thrown error, and the run ends with that reason.
**Why:** the answer was cut or refused, so the calls cannot be trusted to be what the model meant. Without an answer the next turn would send a `tool_use` with no `tool_result`, which Anthropic rejects with a 400.
**Fix:** raise `maxTokens`, or ask again; the history in `result.messages` is valid to continue from.

### `The token budget (input N) is spent.`

**When:** the usage so far reaches a `budget` limit before the next model call (`BUDGET_EXCEEDED`, `reason: 'budget'`); the message names `input`, `output` or `total`.
**Why:** the check runs between calls, so a single call can overshoot; the run stops before the next one. Input counts every input token, cached ones included, so a large cached prompt spends the input budget too.
**Fix:**

```ts
runAgent({ model, messages, tools, budget: { maxTotalTokens: 50_000 } });
```

Raise the limit, or shorten the history (see `estimateTokens`).

### `The model call was aborted` / `Tool "..." was aborted.`

**When:** the `signal` you passed aborted (`ABORTED`, `reason: 'aborted'`).
**Why:** the run was cancelled on purpose, for example the client disconnected. It is not a failure.
**Fix:** treat it as a cancel, not an error.

```ts
if (result.error?.code === 'ABORTED') return; // cancelled
```

### A tool kept running after the run ended `aborted`

**When:** the run ended `aborted` at once, but a tool's side effect (a write, a request) still happened afterwards.
**Why:** the loop does not wait for a tool that ignores `ToolContext.signal`. It answers `ABORTED` for it and ends the run; the tool runs to its end in the background.
**Fix:** pass the signal to whatever the tool waits on.

```ts
execute: async (input, { signal }) => fetch(url, { signal }),
```

### The run goes on after leaving the `for await` loop

**When:** you `break` out of `for await (const event of run)` and the model or tools keep being called, or a second loop over the same run misses events.
**Why:** `AgentRun` is a single-consumer iterator; leaving the loop does not abort the run, and two loops split the events.
**Fix:** read the run in one place and call `run.abort()` when you stop reading.

```ts
for await (const event of run) if (done(event)) break;
run.abort();
```

## Model

### `The model stream ended without a finish`

**When:** calling `generate` or running an agent with an adapter whose stream stops without a `finish` event (`MODEL_ERROR`).
**Why:** the adapter, or a custom `ModelAdapter`, dropped the connection or forgot to emit `finish`.
**Fix:** end every stream with `{ type: 'finish', reason }`.

```ts
yield { type: 'finish', reason: 'end' };
```

### `MODEL_ERROR`, `RATE_LIMITED`, `AUTHENTICATION` from a provider

**When:** the provider call fails. The adapters raise subclasses with a finer `kind`.
**Why:** see the provider's page.
**Fix:** [Anthropic](../../ai-anthropic/docs/troubleshooting.md), [Ollama](../../ai-ollama/docs/troubleshooting.md). Always keep a `default` branch when you switch on `code`; new codes can be added in a minor version.

## Proposed actions

### `Action "..." is confirmed, not pending.`

**When:** `runConfirmedAction` on an action that is neither `pending` nor `running`, or `rejectAction` on one that is not `pending` (`ACTION_NOT_PENDING`, thrown); the status in the message may be `running`, `confirmed`, `rejected`, `expired` or `failed`. `actionOutcomeMessage` on a `pending` or `running` action throws it too.
**Why:** an action runs once. A double click, a retry or a replay found it already settled.
**Fix:** store the returned action and check its status before confirming.

```ts
if (action.status === 'pending')
	action = await runConfirmedAction(action, tools);
```

### The model still says the action is pending

**When:** the user confirmed or rejected in a later request and the model keeps waiting, or asks again.
**Why:** its earlier `tool_result` for that call says `{ status: 'pending' }` and nothing told it the outcome.
**Fix:** append `actionOutcomeMessage(action)` (a user text turn) to the thread before the next `runAgent`.

```ts
const done = await runConfirmedAction(action, tools);
await store.append(threadId, ownerId, [actionOutcomeMessage(done)]);
```

### `Action "..." is still pending: it has no outcome yet.`

**When:** `actionOutcomeMessage` on an action whose status is `pending` (`ACTION_NOT_PENDING`, thrown).
**Why:** it reports an outcome, and a pending action has none.
**Fix:** pass what `runConfirmedAction` or `rejectAction` returned, not the stored pending action.

### A proposed action has no `summary`

**When:** the confirmation UI shows no line although the tool has `summarize`.
**Why:** `summarize` threw, or returned an empty or non-string value; the error is swallowed so the proposal still stands.
**Fix:** call `summarize` in a unit test with the same input and make it return a non-empty string.

### `Action "..." has expired.`

**When:** confirming or rejecting after `expiresAt` (`ACTION_EXPIRED`, thrown).
**Why:** a proposal is only valid for `proposalTtlMs` after the model proposed it, so a stale approval cannot run.
**Fix:** ask the model to propose it again, or lengthen the window.

```ts
runAgent({ model, messages, tools, proposalTtlMs: 30 * 60_000 });
```
