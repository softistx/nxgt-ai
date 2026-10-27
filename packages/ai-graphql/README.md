# @nxgt/ai-graphql

GraphQL operations as [`@nxgt/ai-core`](../ai-core) tools. You allow-list
operations; each becomes a tool the model can call, executed in process with
graphql-js against your schema. Forbidden fields are rejected when the tools are
built, and every mutation waits for a confirmation. Peers: `@nxgt/ai-core`,
`graphql` (16 or 17), `zod`. No Apollo and no other client.

```ts
import { runAgent } from '@nxgt/ai-core';
import { graphqlTools } from '@nxgt/ai-graphql';
import { buildSchema } from 'graphql';
import { z } from 'zod';

// Your executable schema, with its resolvers.
declare const schema: ReturnType<typeof buildSchema>;

const tools = graphqlTools<{ userId: string }>({
	schema,
	operations: [
		{
			name: 'find_books',
			description:
				'Search the catalogue by title; returns at most `limit` books',
			document: `query FindBooks($title: String!, $limit: Int) {
				books(title: $title, limit: $limit) { id title available }
			}`,
			variables: z.object({
				title: z.string().describe('Part of the title'),
				limit: z.number().int().max(20).optional(),
			}),
		},
		{
			name: 'renew_loan',
			description: 'Renew a loan for two weeks',
			document: `mutation RenewLoan($loanId: ID!) { renewLoan(loanId: $loanId) { id dueDate } }`,
			variables: z.object({ loanId: z.string() }),
		},
	],
	// The GraphQL context of each call, built from the run's context.
	context: ({ context }) => ({ viewer: context.userId }),
	forbidFields: ['Member.address', 'Member.phone', 'Librarian.nationalId'],
	maxResultChars: 8000,
});

const run = runAgent({ model, messages, tools, context: { userId: 'u1' } });
```

`find_books` runs directly. `renew_loan` is a mutation, so the loop records a
proposed action (`confirm: true`) and runs it only after
`runConfirmedAction`.

## Exports

| Export                                           | What it is                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `graphqlTools(options)`                          | Builds the tools; throws `GraphqlToolsError` on the first problem                                                       |
| `GraphqlOperation`                               | `{ name, description, document, variables?, operationName? }`: the allow-list entry and the shape the codegen will emit |
| `GraphqlToolsOptions`                            | `{ schema, operations, context?, forbidFields?, maxResultChars? }`                                                      |
| `GraphqlToolsError`, `GRAPHQL_TOOLS_ERROR_CODES` | `FORBIDDEN_FIELD`, `INVALID_OPERATION`, `DUPLICATE_OPERATION`; carries `operation`, `field`, `path`                     |
| `GraphqlToolOutput`, `ToolGraphqlError`          | What a call returns: `{ data, errors? }`, each error `{ code, path?, fields?, params? }`                                |
| `TruncatedGraphqlOutput`                         | `{ truncated: true, originalChars, preview, note }`, returned when the result exceeds `maxResultChars`                  |
| `DEFAULT_MAX_RESULT_CHARS`                       | 20000                                                                                                                   |

## Traps

- `forbidFields` is checked when the tools are built, never at run time, and only against the operations you allow: the model cannot write its own query.
- A field forbidden on an interface is forbidden on every type that implements it, and a field forbidden on a type is caught when read through an interface or a union. Aliases do not hide it.
- `forbidFields` stops what the model selects, not what your resolvers return: keep authorisation in the resolvers.
- Subscriptions are rejected. Queries and mutations only.
- The model sees error codes (`extensions.code`, plus `extensions.fields` and scalar `extensions.params`), never messages or stacks. An error without a code reads `INTERNAL_ERROR`.
- When the whole operation fails (no `data`), the tool call reports `TOOL_FAILED` with the mapped errors in its message; when part of it fails, the call succeeds with `data` and `errors`.
- A result longer than `maxResultChars` becomes `{ truncated: true, originalChars, preview, note }`; make the model narrow its variables.
- graphql-js `execute` takes no abort signal: an abort is honoured before the operation starts, not during it.

## Install

```sh
bun add @nxgt/ai-graphql @nxgt/ai-core graphql zod
```

Requires `"moduleResolution": "bundler"`. This package is not published yet.
See the [guide](docs/guide/graphql-tools.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
