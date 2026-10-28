# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

- **GraphQL tools** — `graphqlTools`: you get:
  - an allow-list of operations (name, description, Zod variables) as `@nxgt/ai-core` tools, run in process with graphql-js;
  - `forbidFields` checked at build, fragments included, with a typed error naming the operation and the field path;
  - mutations behind a confirmation, GraphQL errors as codes, and results cut to `maxResultChars`.
- **Operations manifest codegen** — `@nxgt/ai-graphql/codegen`: a graphql-codegen plugin that writes the manifest for `graphqlTools` from your documents, you get:
  - one entry per query or mutation, with its fragments and the `z<Op>Variables` schema of `@nxgt/graphql-codegen-zod`;
  - the description from the operation or a `# tool:` comment, and a clear error for a missing one, a subscription or a duplicate;
  - sorted, stable output.

## Next

Nothing yet.

## Later

Nothing yet.

## Not planned

- **Letting the model write GraphQL** — the allow-list is the safety model.
- **A GraphQL client or HTTP transport** — tools run in process against your schema.
- **Subscriptions** — a tool call is one request and one answer.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
