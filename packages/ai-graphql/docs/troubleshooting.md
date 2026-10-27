# Troubleshooting

- [`GraphqlToolsError` FORBIDDEN_FIELD](#graphqltoolserror-forbidden_field)
- [`GraphqlToolsError` INVALID_OPERATION](#graphqltoolserror-invalid_operation)
- [`GraphqlToolsError` DUPLICATE_OPERATION](#graphqltoolserror-duplicate_operation)
- [`INVALID_TOOL_INPUT` on a tool call](#invalid_tool_input-on-a-tool-call)
- [`TOOL_FAILED` with `The GraphQL operation failed`](#tool_failed-with-the-graphql-operation-failed)
- [The model sees `INTERNAL_ERROR`](#the-model-sees-internal_error)
- [The model sees `{ truncated: true, preview }`](#the-model-sees--truncated-true-preview-)
- [A forbidden field still reaches the model](#a-forbidden-field-still-reaches-the-model)
- [A mutation never runs](#a-mutation-never-runs)
- [An abort does not stop a running operation](#an-abort-does-not-stop-a-running-operation)

## `GraphqlToolsError` FORBIDDEN_FIELD

**When:** `graphqlTools` throws `Operation "…" selects the forbidden field Type.field at a.b.c.`
**Why:** the operation selects a field of `forbidFields`, directly, in a nested selection, or in a fragment. `error.operation`, `error.field` and `error.path` name it; a fragment is named in the message.
**Fix:** remove the field from the operation, or drop it from `forbidFields` if it is allowed.

```ts
try {
	graphqlTools({ schema, operations, forbidFields });
} catch (error) {
	if (error instanceof GraphqlToolsError && error.code === 'FORBIDDEN_FIELD') {
		console.error(error.operation, error.field, error.path);
	}
}
```

## `GraphqlToolsError` INVALID_OPERATION

**When:** `graphqlTools` throws at build with `does not parse`, `is not valid against the schema`, `is a subscription`, `set operationName`, a `forbidFields` entry that is not `Type.field`, or a bad `maxResultChars`.
**Why:** the document does not parse or does not validate against `schema` (an unknown field, a missing argument), is a subscription, or holds several operations.
**Fix:** correct the document; set `operationName` when it holds several; use `Type.field` entries; give `maxResultChars` a positive integer.

## `GraphqlToolsError` DUPLICATE_OPERATION

**When:** `graphqlTools` throws `Two operations are named "…".`
**Why:** tool names must be unique.
**Fix:** rename one; the `name` is the tool name, not the GraphQL operation name.

## `INVALID_TOOL_INPUT` on a tool call

**When:** the model's call comes back as an error result with the Zod issues.
**Why:** the input does not satisfy the operation's `variables` schema.
**Fix:** nothing in code: the model reads the issues and retries. Add `.describe()` to fields so it sends the right shape.

## `TOOL_FAILED` with `The GraphQL operation failed`

**When:** a tool result is an error whose message ends with a JSON list of `{ code, … }`.
**Why:** the execution returned no `data`: a non-null root field failed, or execution threw.
**Fix:** read the codes. Fix the resolver or give it an `extensions.code` for the model to act on.

## The model sees `INTERNAL_ERROR`

**When:** an error carries `code: "INTERNAL_ERROR"`.
**Why:** the GraphQL error has no `extensions.code`, or it is not letters, digits and `_` (at most 64). Messages are never forwarded.
**Fix:** throw `new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } })` from the resolver.

## The model sees `{ truncated: true, preview }`

**When:** a result is a `TruncatedGraphqlOutput`.
**Why:** the serialised `{ data, errors }` is longer than `maxResultChars`.
**Fix:** add a limit or paging variable to the operation, select fewer fields, or raise `maxResultChars` if the model's context allows.

## A forbidden field still reaches the model

**When:** a value you meant to hide appears in a result.
**Why:** `forbidFields` checks what the operations select. A resolver that returns the value in another field, or a field with a different `Type.field` name, is not caught.
**Fix:** list every `Type.field` that holds it (interfaces count for their implementers) and authorise in the resolvers.

## A mutation never runs

**When:** the model calls a mutation tool and the result is `{ status: 'pending', actionId }`.
**Why:** mutations have `confirm: true`: the loop proposes them.
**Fix:** store the proposed action, ask the user, then call `runConfirmedAction(action, tools, { context })`.

## An abort does not stop a running operation

**When:** the run is aborted while a query is executing.
**Why:** graphql-js `execute` takes no signal; the abort is checked before the operation starts.
**Fix:** read `signal` from your `context` builder (`context: ({ signal }) => ({ signal })`) and pass it to your data sources.
