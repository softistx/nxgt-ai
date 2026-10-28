# Troubleshooting

- [`GraphqlToolsError` FORBIDDEN_FIELD](#graphqltoolserror-forbidden_field)
- [`GraphqlToolsError` INVALID_OPERATION](#graphqltoolserror-invalid_operation)
- [`GraphqlToolsError` INVALID_OPTIONS](#graphqltoolserror-invalid_options)
- [`GraphqlToolsError` DUPLICATE_OPERATION](#graphqltoolserror-duplicate_operation)
- [`INVALID_TOOL_INPUT` on a tool call](#invalid_tool_input-on-a-tool-call)
- [`TOOL_FAILED` with `The GraphQL operation failed`](#tool_failed-with-the-graphql-operation-failed)
- [The model sees `INTERNAL_ERROR`](#the-model-sees-internal_error)
- [The model sees `{ truncated: true, preview }`](#the-model-sees--truncated-true-preview-)
- [A forbidden field still reaches the model](#a-forbidden-field-still-reaches-the-model)
- [A mutation never runs](#a-mutation-never-runs)
- [An abort does not stop a running operation](#an-abort-does-not-stop-a-running-operation)
- [Codegen: operation "…" has no description](#codegen-operation--has-no-description)
- [Codegen: operation "…" is a subscription](#codegen-operation--is-a-subscription)
- [Codegen: an anonymous operation cannot become a tool](#codegen-an-anonymous-operation-cannot-become-a-tool)
- [Codegen: two operations are named "…"](#codegen-two-operations-are-named-)
- [Codegen: operation "…" spreads the fragment "…"](#codegen-operation--spreads-the-fragment-)
- [Codegen: fragment "…" is defined in two documents](#codegen-fragment--is-defined-in-two-documents)
- [Codegen: "names" maps "…", which is no operation](#codegen-names-maps--which-is-no-operation)
- [Codegen: exportName "…" is not a valid identifier](#codegen-exportname--is-not-a-valid-identifier)
- [Codegen: the tool name "…" of operation "…" must be letters, digits](#codegen-the-tool-name--of-operation--must-be-letters-digits)
- [Codegen: schemaPrefix, typesPrefix, typesSuffix, zodImport, typesImport or namingConvention is refused](#codegen-schemaprefix-typesprefix-typessuffix-zodimport-typesimport-or-namingconvention-is-refused)
- [Codegen: The generated file does not typecheck](#codegen-the-generated-file-does-not-typecheck)

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

**When:** `graphqlTools` throws at build with `does not parse`, `is not valid against the schema`, `is a subscription`, `set operationName`, `cannot become a JSON Schema`, or `variables must be a Zod object schema`.
**Why:** the document does not parse or does not validate against `schema` (an unknown field, a missing argument), is a subscription, or holds several operations. For `cannot become a JSON Schema`: the `variables` schema holds a type JSON Schema cannot express (a `z.date()`, a transform, a `z.custom` that is not a list written by `@nxgt/graphql-codegen-zod`). Lists written by the plugin are fine: the model sees a plain array.
**Fix:** correct the document; set `operationName` when it holds several; for the variables, use a type JSON Schema can describe (`z.string()` plus a format, `z.number()`).

## `GraphqlToolsError` INVALID_OPTIONS

**When:** `graphqlTools` throws `forbidFields entry "…" must look like "Type.field".`, `forbidFields entry "…" names the type "…", which the schema does not have.`, `… names the field "…", which type "…" does not declare.`, `… is not an object or interface type …`, `maxResultChars must be an integer of at least 100`, or `mapErrors must be a function.`.
**Why:** an option is malformed, or a `forbidFields` entry names nothing in the schema (a typo, or a type or field renamed since the entry was written: an entry that matched nothing would protect nothing, so it is refused). The field must be declared by the named type itself: `Person.nationalId` is refused when only `Librarian` declares `nationalId`; name `Librarian.nationalId`. A union has no fields, and an introspection field such as `__typename` is never checked, so listing it is refused too. `operation` is `undefined` because no operation is at fault.
**Fix:** correct the entry to a `Type.field` the schema declares, or drop it; give `maxResultChars` an integer of at least 100; pass `mapErrors` a function or leave it out.

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
**Why:** a mutation reported an error, or a query returned no `data` or only null root values; or the `context` builder or serialisation failed (`INTERNAL_ERROR`).
**Fix:** read the codes. Fix the resolver or give it an `extensions.code` for the model to act on.

## The model sees `INTERNAL_ERROR`

**When:** an error carries `code: "INTERNAL_ERROR"`.
**Why:** the GraphQL error has no `extensions.code`, or it is not letters, digits, `_`, `.` and `-` (at most 100), for example it holds a space. Messages are never forwarded.
**Fix:** throw `new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } })` from the resolver, or reshape your own codes with the `mapErrors` option. If `mapErrors` is set and still gives `INTERNAL_ERROR`, it threw, returned a promise or an empty list, or returned a code outside that pattern: the hook's result is ignored in those cases.

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

## Codegen: operation "…" has no description

**When:** graphql-codegen fails with `@nxgt/ai-graphql/codegen: operation "FindTickets" has no description.`
**Why:** the model reads the description to choose the tool, so the plugin will not write a tool without one. The operation has no graphql 17 description and no `# tool:` comment _directly_ above it: a blank line cuts it off, and so does a comment inside the braces or above a fragment. The plugin reads comments from the file on disk, so a document that does not come from a `.graphql` file (a `gql` tag in a `.ts` file) has none.
**Fix:** put the comment on the lines just above the operation, or use a `"""description"""` (graphql 17).

```graphql
# tool: List the open tickets of a customer, newest first.
query FindTickets($customerId: ID!) {
	tickets(customerId: $customerId) {
		id
	}
}
```

## Codegen: operation "…" is a subscription

**When:** generation fails with `operation "Watch" is a subscription; only queries and mutations become tools.`
**Why:** a tool call is one request and one answer.
**Fix:** keep subscriptions out of the `documents` this plugin reads, for example with a separate `generates` entry that has its own `documents`.

## Codegen: an anonymous operation cannot become a tool

**When:** generation fails with `an anonymous operation cannot become a tool: give it a name`.
**Why:** an anonymous operation has no name for the tool, nor for its `z<Op>Variables` schema.
**Fix:** name it: `query FindTickets { … }`.

## Codegen: two operations are named "…"

**When:** generation fails with `two operations are named "FindTickets"; rename one or map it in "names".`
**Why:** tool names are unique; two operations, or an operation and a `names` mapping, give the same one.
**Fix:** rename an operation, or map it: `config: { names: { FindTickets: 'find_tickets' } }`.

## Codegen: operation "…" spreads the fragment "…"

**When:** generation fails with `operation "FindTickets" spreads the fragment "TicketFields", which is in none of the documents.`
**Why:** the manifest carries each operation's fragments, and this one is defined in no file of `documents`.
**Fix:** add the file that defines it to `documents`, or fix the fragment's name.

## Codegen: fragment "…" is defined in two documents

**When:** generation fails with `fragment "TicketFields" is defined in two documents with different text; rename one.`
**Why:** two files define a fragment with the same name and different text, so the manifest cannot tell which an operation means.
**Fix:** rename one of them, or make them identical.

## Codegen: "names" maps "…", which is no operation

**When:** generation fails with `"names" maps "FindTicket", which is no operation of the documents.`
**Why:** a key of `names` matches no operation name, usually a typo.
**Fix:** use the GraphQL operation name as the key: `names: { FindTickets: 'find_tickets' }`.

## Codegen: exportName "…" is not a valid identifier

**When:** generation fails with `exportName "find-tickets" is not a valid identifier.`
**Why:** the name becomes `export const <exportName> = [...]`.
**Fix:** use letters, digits, `_` and `$`, not starting with a digit.

## Codegen: the tool name "…" of operation "…" must be letters, digits

**When:** generation fails with `the tool name "find tickets" of operation "FindTickets" must be letters, digits, "_" and "-", at most 64.`
**Why:** the name comes from a `names` mapping (a GraphQL operation name is always valid) and is longer than 64 or holds other characters.
**Fix:** map it to a name made of letters, digits, `_` and `-`.

## Codegen: schemaPrefix, typesPrefix, typesSuffix, zodImport, typesImport or namingConvention is refused

**When:** generation fails with `schemaPrefix "a-b" must be letters, digits, "_" and "$" only.` or `zodImport must be a non-empty string.`; a `namingConvention` it cannot read is refused by `@nxgt/graphql-codegen-zod`.
**Why:** these options build identifiers and import paths in the generated file; `namingConvention` is the one of `@nxgt/graphql-codegen-zod` (`keep`, a function, `change-case-all#<case>`, `change-case#<case>`), which also computes the names.
**Fix:** correct the option; give both plugins the same values.

## Codegen: The generated file does not typecheck

**When:** `tsc` reports `has no exported member 'zFindTicketsQueryVariables'` or cannot find `./zod`.
**Why:** the manifest imports each schema under the name `@nxgt/graphql-codegen-zod` gives it, from `zodImport` (default `./zod`, relative to the manifest). Different `schemaPrefix`, `typesPrefix`, `typesSuffix`, `namingConvention`, `dedupeOperationSuffix` or `omitOperationSuffix` on the two plugins, a manifest written elsewhere, or `moduleResolution: nodenext` (which wants `.js`) breaks it.
**Fix:** set the same options on both plugins and point `zodImport` at the generated zod file.

```ts
config: { zodImport: './zod.js', schemaPrefix: 'z', dedupeOperationSuffix: true },
```
