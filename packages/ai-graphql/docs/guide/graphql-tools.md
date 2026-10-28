# GraphQL tools

`graphqlTools` turns an allow-list of GraphQL operations into `@nxgt/ai-core`
tools. The model chooses an operation and its variables; it never writes a
query. Execution is in process, with graphql-js `execute` against the schema
you pass.

- [Define the operations](#define-the-operations)
- [Context](#context)
- [Forbid fields](#forbid-fields)
- [Queries and mutations](#queries-and-mutations)
- [Errors the model sees](#errors-the-model-sees)
- [Result size](#result-size)
- [Test your tools](#test-your-tools)

## Define the operations

```ts
import { graphqlTools, type GraphqlOperation } from '@nxgt/ai-graphql';
import { z } from 'zod';

const findTickets: GraphqlOperation = {
	name: 'find_tickets',
	description: 'List open support tickets of a customer, newest first',
	document: `
		query FindTickets($customerId: ID!, $first: Int) {
			tickets(customerId: $customerId, first: $first) { id subject status }
		}`,
	variables: z.object({
		customerId: z.string().describe('The customer id'),
		first: z.number().int().min(1).max(25).optional(),
	}),
};

const tools = graphqlTools({ schema, operations: [findTickets] });
```

| Field           | Meaning                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | The tool name: letters, digits, `_` and `-`, at most 64. Unique in the list.                                                                                                                                                                                                                                                                          |
| `description`   | What the model reads to decide when to call the tool.                                                                                                                                                                                                                                                                                                 |
| `document`      | Source text, or a parsed `DocumentNode` (a `TypedDocumentNode` works). Fragments go in the same document.                                                                                                                                                                                                                                             |
| `variables`     | A Zod object schema. It is the tool's input: its JSON Schema is sent to the model and the model's input is validated by it. Default: no variables.                                                                                                                                                                                                    |
| `summarize`     | Optional `(variables) => string`: the confirmation line of a mutation (`ProposedActionPart.summary`), for example `` `Renew loan of book ${v.bookId}` ``. Mutations only: a query is never proposed, so its `summarize` is never called. A throw leaves the summary out. Deriving it from the description and variables automatically is a follow-up. |
| `operationName` | Which operation to run when the document holds several.                                                                                                                                                                                                                                                                                               |

This is the whole shape on purpose: a manifest of
`{ name, description, document, variables }` (with `variables` the
`z<Op>Variables` of `@nxgt/graphql-codegen-zod`) is what the `./codegen` plugin
emits ([codegen guide](codegen.md)), and it can be passed as `operations` as is.

Each operation is parsed and validated against the schema when `graphqlTools`
is called. A `DocumentNode` is copied (printed and parsed again) at that moment,
so changing it later changes nothing. `@defer` and `@stream` are rejected. A subscription, an unparsable or invalid document, or a duplicate
name throws a `GraphqlToolsError` (`INVALID_OPERATION`, `DUPLICATE_OPERATION`).
A bad option (a `forbidFields` entry that is not `Type.field` or that names a
type or field the schema does not have, a `maxResultChars` that is not an
integer of at least 100) throws `INVALID_OPTIONS`, with no `operation`.

When the model sends input the Zod schema refuses, the call answers
`INVALID_TOOL_INPUT` with the issues and the operation does not run. The model
can read it and correct itself.

### List variables

`@nxgt/graphql-codegen-zod` writes a list variable (or a list field of an
input object) so that a single value is also accepted, which Zod cannot turn
into JSON Schema. `graphqlTools` shows the model the plain array (`type:
"array"`, items typed by the item schema) and validates with your Zod
schema unchanged, so `{ ids: ["a"] }` passes, `{ ids: [1] }` is refused, and
the single-value form still works for any caller that sends it. Any other
type JSON Schema cannot express still fails at build with
`GraphqlToolsError` `INVALID_OPERATION`.

## Context

`context` builds the GraphQL context of each call from the tool context, which
holds the run's `context`, the abort signal and the call id.

```ts
const tools = graphqlTools<{ userId: string }>({
	schema,
	operations,
	context: ({ context }) => ({ viewer: context.userId }),
});
// runAgent({ ..., tools, context: { userId } })
```

Without `context`, the run's `context` is the GraphQL context unchanged. Build
the viewer from the authenticated request, never from model input.

## Forbid fields

```ts
graphqlTools({
	schema,
	operations,
	forbidFields: ['Customer.address', 'Customer.phone', 'Agent.nationalId'],
});
```

Each entry is `Type.field`. When building, the selection set of every operation
is walked against the schema, named and inline fragments included. The first
hit throws:

```
GraphqlToolsError FORBIDDEN_FIELD
  Operation "find_tickets" selects the forbidden field Customer.address at tickets.customer.address (through fragment Contact).
  error.operation === 'find_tickets'
  error.field     === 'Customer.address'
  error.path      === 'tickets.customer.address'   // response keys, aliases used
```

Rules:

- Every entry must exist in the schema, or `graphqlTools` throws `INVALID_OPTIONS` naming it: a rename that leaves an entry behind fails the build instead of silently protecting nothing.
- The named type must be an object or interface type that declares the field itself. `Person.nationalId` is refused when only `Librarian` declares `nationalId`; write `Librarian.nationalId`. A union has no fields of its own, so name the member types.
- A field forbidden on an interface is forbidden on the types that implement it.
- A field forbidden on an object type is caught when read through an interface or union it belongs to.
- Aliases do not hide a field, and `__typename` is ignored.
- It guards what the allow-listed operations select. It does not filter what a resolver returns; authorise in resolvers.
- It does not look at arguments or variables. A filter such as `where: { phone: $p }` lets the model test values of a hidden field. The operation author controls the arguments; do not expose such filters, and authorise in resolvers.
- Introspection fields (`__typename`, `__schema`) are metadata and are skipped.

## Queries and mutations

A query runs when the model calls it. A mutation becomes a tool with
`confirm: true`: `runAgent` does not run it, it records a proposed action. Show
the action to the user, then run it:

```ts
import { runConfirmedAction } from '@nxgt/ai-core';

const done = await runConfirmedAction(action, tools, { context: { userId } });
// done.status: 'confirmed' with done.result, or 'failed'
```

`runConfirmedAction` validates the stored input again before it runs.

A failed mutation may still have committed some of its root fields, so
`failed` does not mean nothing changed.

## Errors the model sees

The model never gets a GraphQL message or a stack, only codes.

| GraphQL error has                                             | The model reads                         |
| ------------------------------------------------------------- | --------------------------------------- |
| `extensions.code` (letters, digits, `_`, `.`, `-`; up to 100) | `code`                                  |
| no code, or an odd one                                        | `INTERNAL_ERROR`                        |
| `extensions.fields`, an array of strings                      | `fields` (up to 20)                     |
| `extensions.params`, an object                                | `params`, scalar values only (up to 20) |
| a response path                                               | `path`                                  |

Two outcomes:

- **A query that partly failed** (some root value is not null): the call succeeds with `{ data, errors: [{ code, path, fields?, params? }] }`.
- **Everything failed, or any mutation error** (`data` is null, every root value is null, or the operation is a mutation with any error): the call is an error, `TOOL_FAILED`, whose message is `The GraphQL operation failed: [{"code":"NOT_FOUND","fields":["id"]}]`. A confirmed mutation becomes `failed`.
- **A throwing `context` builder** fails the call the same way with `INTERNAL_ERROR`; its message and stack are never shown (an abort is rethrown as is).

### Mapping errors with `mapErrors`

`graphqlTools` runs graphql-js `execute` in process, so the error formatting
of your server (a Yoga plugin, `maskedErrors`) does not apply. Give it your own
with `mapErrors`: it receives the `GraphQLError`s of one call and
`{ operation }` (the tool name) and returns what the model reads.

```ts
const tools = graphqlTools({
	schema,
	operations,
	mapErrors: (errors, { operation }) =>
		errors.map((e) => ({
			code: appCode(e) ?? 'INTERNAL_ERROR', // for example 'validation.errors.invalid-input'
			...(e.path ? { path: [...e.path] } : {}),
		})),
});
```

- It stays no-leak: each returned entry is cut down to `code`, `path`, `fields` and scalar `params` (the limits above). Anything else, such as a `message`, is dropped.
- A `code` must be letters, digits, `_`, `.` or `-`, at most 100. A hook that throws, returns a promise, an empty list or an entry with another code is ignored and the default mapping applies to that call. The hook is synchronous.
- It applies to both outcomes: the `errors` next to partial `data`, and the failure of a mutation or of a query that returned nothing. It does not apply to a throwing `context` builder or to an unserialisable result, which stay `INTERNAL_ERROR`.
- Return the same number of errors you got unless you mean to hide some; the model reads exactly the list you return.

`fields` strings are cut to 200 characters. `params` scalars are shown as the resolver set them, so keep secrets out of them.

Throw errors with codes in your resolvers so the model can act on them:

```ts
throw new GraphQLError('Ticket row 42 not found', {
	extensions: { code: 'NOT_FOUND', fields: ['ticketId'] }, // the message is not sent
});
```

## Result size

The result is serialised (`{ data, errors? }`) and cut so that the marker below,
serialised, is at most `maxResultChars` characters (default 20000, at least 100). With a very
small limit the note, then the preview, are dropped. Data JSON cannot hold (a
BigInt, a cycle) fails the call with `INTERNAL_ERROR`:

```json
{
	"truncated": true,
	"originalChars": 83114,
	"preview": "{\"data\":{\"tickets\":[{\"id\":\"1\",...",
	"note": "The result was cut to 8000 of 83114 characters. Ask again with narrower variables (a filter, a smaller limit or page) or fewer fields."
}
```

Give list operations a `limit` or `first` variable with a `max` so the model can
narrow its own request.

## Test your tools

Tools are plain `@nxgt/ai-core` tools. Run one with `executeTool`, or script a
whole agent with `fakeModel` from `@nxgt/ai-testing`:

```ts
import { executeTool } from '@nxgt/ai-core';

const [tool] = graphqlTools({ schema, operations: [findTickets] });
const result = await executeTool(
	tool,
	{
		type: 'tool-call',
		id: 'c1',
		name: 'find_tickets',
		input: { customerId: '1' },
	},
	{ context: { userId: 'agent-1' } },
);
```
