# @nxgt/ai-graphql

GraphQL operations as [`@nxgt/ai-core`](https://www.npmjs.com/package/@nxgt/ai-core) tools. You allow-list
operations; each becomes a tool the model can call, executed in process with
graphql-js against your schema. Forbidden fields are rejected when the tools are
built, and every mutation waits for a confirmation. Peers: `@nxgt/ai-core`,
`graphql` (16 or 17), `zod`. No Apollo and no other client.

```ts
import { runAgent } from '@nxgt/ai-core';
import { graphqlTools } from '@nxgt/ai-graphql';
import { fakeModel } from '@nxgt/ai-testing';
import { buildSchema } from 'graphql';
import { z } from 'zod';

// Your executable schema, with its resolvers (here one field, to stay short).
const schema = buildSchema(`
	type Book { id: ID! title: String! available: Boolean! shelfCode: String }
	type Loan { id: ID! dueDate: String! }
	type Query { books(title: String!, limit: Int): [Book!]! }
	type Mutation { renewLoan(loanId: ID!): Loan! }
`);
const books = [{ id: '1', title: 'Dune', available: true }];
const booksField = schema.getQueryType()?.getFields()['books'];
if (booksField) {
	booksField.resolve = (_source, args: { title: string }) =>
		books.filter((b) => b.title.includes(args.title));
}

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
	forbidFields: ['Book.shelfCode'],
	maxResultChars: 8000,
});

// A scripted model for the example; use @nxgt/ai-anthropic or @nxgt/ai-ollama in production.
const model = fakeModel([
	{ toolCalls: [{ name: 'find_books', input: { title: 'Dune' } }] },
	{ text: 'Found it.' },
]);
const messages = [
	{
		role: 'user' as const,
		parts: [{ type: 'text' as const, text: 'Is Dune in?' }],
	},
];

const run = runAgent({ model, messages, tools, context: { userId: 'u1' } });
for await (const event of run) console.log(event.type);
```

`find_books` runs directly. `renew_loan` is a mutation, so the loop records a
proposed action (`confirm: true`) and runs it only after
`runConfirmedAction`.

## Codegen

`@nxgt/ai-graphql/codegen` is a [GraphQL Code Generator](https://the-guild.dev/graphql/codegen)
plugin that writes the operations for you: one `GraphqlOperation` per named query or
mutation of your documents, each with its fragments, its description and the
`z<Op>Variables` schema that [`@nxgt/graphql-codegen-zod`](https://www.npmjs.com/package/@nxgt/graphql-codegen-zod) wrote.

```ts
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: 'src/schema/**/*.graphql',
	documents: 'src/operations/**/*.graphql',
	generates: {
		'src/generated/zod.ts': { plugins: ['@nxgt/graphql-codegen-zod'] },
		'src/generated/operations.ts': {
			plugins: ['@nxgt/ai-graphql/codegen'],
			config: { zodImport: './zod' }, // the file written above
		},
	},
};
export default config;
```

```graphql
# tool: List the open tickets of a customer, newest first.
query FindTickets($customerId: ID!) { ... }
```

```ts
import { operations } from './generated/operations';

const tools = graphqlTools({ schema, operations });
```

Each operation needs a description (a graphql 17 description or the `# tool:`
comment above it). See the [codegen guide](docs/guide/codegen.md) for the
options, what is refused and the limits.

## API

| Export                                                           | What it is                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graphqlTools(options)`                                          | Builds the tools; throws `GraphqlToolsError` on the first problem                                                                                     |
| `GraphqlOperation`                                               | `{ name, description, document, variables?, operationName? }`: the allow-list entry and the shape the codegen emits                                   |
| `GraphqlToolsOptions`                                            | `{ schema, operations, context?, forbidFields?, maxResultChars? }`                                                                                    |
| `GraphqlToolsError`, `GRAPHQL_TOOLS_ERROR_CODES`                 | `FORBIDDEN_FIELD`, `INVALID_OPERATION`, `INVALID_OPTIONS`, `DUPLICATE_OPERATION`; carries `operation` (absent for `INVALID_OPTIONS`), `field`, `path` |
| `GraphqlToolOutput`, `ToolGraphqlError`                          | What a call returns: `{ data, errors? }`, each error `{ code, path?, fields?, params? }`                                                              |
| `TruncatedGraphqlOutput`                                         | `{ truncated: true, originalChars, preview, note }`, returned when the result exceeds `maxResultChars`                                                |
| `DEFAULT_MAX_RESULT_CHARS`                                       | 20000                                                                                                                                                 |
| `@nxgt/ai-graphql/codegen`: `plugin`, `OperationsManifestConfig` | The codegen plugin and its `config` type                                                                                                              |

## Traps

- `forbidFields` is checked when the tools are built, never at run time, and only against the operations you allow: the model cannot write its own query.
- A field forbidden on an interface is forbidden on every type that implements it, and a field forbidden on a type is caught when read through an interface or a union. Aliases do not hide it.
- A failed mutation may still have committed some of its root fields, so `failed` does not mean nothing changed.
- `forbidFields` stops what an operation selects. It does not guard what your resolvers return, nor arguments and variables: a filter such as `where: { phone }` can act as a lookup oracle on a hidden field. The operation author controls the arguments; keep authorisation in the resolvers.
- Introspection fields (`__typename`, `__schema`) are metadata and are skipped by the check.
- `@defer` and `@stream` are rejected at build (incremental results of graphql 17 are not supported).
- `variables` must be a `z.object(...)`.
- Subscriptions are rejected. Queries and mutations only.
- The model sees error codes (`extensions.code`, plus `extensions.fields` and scalar `extensions.params`), never messages or stacks. An error without a code reads `INTERNAL_ERROR`.
- A mutation that reports any error, and a query with no `data` or whose root fields are all null, make the call fail with `TOOL_FAILED` and the mapped errors in its message; a query that partly fails succeeds with `data` and `errors`. A throwing `context` builder fails the call with `INTERNAL_ERROR` and never shows its message.
- `extensions.params` scalars are shown as the resolver set them: do not put secrets in them.
- `maxResultChars` is at least 100. A result longer than it becomes `{ truncated: true, originalChars, preview, note }`; make the model narrow its variables.
- graphql-js `execute` takes no abort signal: an abort is honoured before the operation starts, not during it.

## Install

```sh
bun add @nxgt/ai-graphql @nxgt/ai-core graphql zod
```

`./codegen` also needs `@graphql-codegen/cli` (it brings `@graphql-codegen/plugin-helpers`) and `@nxgt/graphql-codegen-zod` 0.4 (which you install to generate the zod schemas), both optional peers used by `./codegen` only, so the root export does not. Requires `"moduleResolution": "bundler"`.
See the [guide](docs/guide/graphql-tools.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
