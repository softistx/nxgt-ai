# Tools

A tool is a name, a description the model reads, an input schema and an
`execute` function.

```ts
import { z } from 'zod';
import { defineTool } from '@nxgt/ai-core';

const findNotes = defineTool({
	name: 'find_notes',
	description: 'Find notes whose title contains a text',
	input: z.object({
		text: z.string().min(1).describe('Text to look for'),
		limit: z.number().int().max(50).default(10),
	}),
	output: z.object({ titles: z.array(z.string()) }),
	execute: async ({ text, limit }, { context, signal }) => ({
		titles: await context.notes.search(text, limit, { signal }),
	}),
});
```

- `name`: 1 to 64 letters, digits, `_` or `-`. A bad name or an empty
  description throws `AiError` `INVALID_TOOL_DEFINITION` when the tool is built.
- `input`: a Zod schema of an **object**. `.describe()` on a field reaches the
  model. Fields Zod cannot express in JSON Schema (`z.date()`, transforms in
  `io: 'input'` position) throw when the tool is built; send dates as strings.
- `execute(input, { context, signal, callId })`: `input` is the **parsed**
  value, so a default is applied and `limit` above is a `number`. Annotate the
  second argument to type the context: `{ context }: ToolContext<Viewer>`.
- `output` (optional): when set, the return value is checked against it, the
  result carries the parsed value, and a mismatch is an `INVALID_TOOL_OUTPUT`
  result. Return JSON-serializable values either way.
- `confirm` (default `false`): marks a mutation. `executeTool` does not look at
  it; the agent loop (a later slice) proposes such a call for confirmation
  instead of running it.

## What the model is told

`tool.inputSchema` is the JSON Schema, computed once from the **input** side
of the Zod schema (`z.toJSONSchema(schema, { io: 'input' })`, without
`$schema`): a field with a default is optional there, since the model may omit
it. `toolSpec(tool)` gives `{ name, description, inputSchema }`.

```ts
import { toolSpec } from '@nxgt/ai-core';

toolSpec(findNotes).inputSchema;
// { type: 'object', properties: { text: { type: 'string', minLength: 1, description: '…' }, … }, required: ['text'] }
```

## A JSON Schema you already have

`jsonSchemaTool` takes the JSON Schema as it is (its `type` must be `"object"`).
The package carries no JSON Schema validator: pass `validate` to check the
input, or `execute` receives it as sent.

```ts
import { jsonSchemaTool } from '@nxgt/ai-core';

const lookup = jsonSchemaTool<{ id: string }>({
	name: 'lookup',
	description: 'Look up a record',
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'string' } },
		required: ['id'],
	},
	validate: (input) =>
		typeof (input as { id?: unknown })?.id === 'string'
			? { ok: true, value: input as { id: string } }
			: { ok: false, issues: [{ path: 'id', message: 'expected a string' }] },
	execute: ({ id }) => ({ id }),
});
```

## Running a call

`executeTool(tool, call, { context?, signal? })` validates the call's input and
runs the tool. It resolves to a `tool-result` part in every case:

| Situation                      | Result                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| valid input, `execute` returns | `isError: false`, `output`                                                                                                                           |
| input fails the schema         | `isError: true`, `INVALID_TOOL_INPUT`, with `issues` (`{ path, message }`) and a message that names the tool and each field; `execute` is not called |
| `execute` throws               | `TOOL_FAILED` with the error's message; an `AiError` thrown keeps its own code                                                                       |
| output fails `output`          | `INVALID_TOOL_OUTPUT`                                                                                                                                |
| the `signal` is aborted        | **rejects** with the signal's reason, so the loop can stop                                                                                           |

The model sees the error result and can correct its call. Keep thrown messages
free of secrets: they go back to the model.
