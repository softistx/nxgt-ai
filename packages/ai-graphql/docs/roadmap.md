# Roadmap

A direction, not a commitment. See the [repository roadmap](../../../docs/roadmap.md) for the whole SDK.

## Now

- **GraphQL tools** — `graphqlTools`: you get:
  - an allow-list of operations (name, description, Zod variables) as `@nxgt/ai-core` tools, run in process with graphql-js;
  - `forbidFields` checked at build, fragments included, with a typed error naming the operation and the field path;
  - mutations behind a confirmation, GraphQL errors as codes, and results cut to `maxResultChars`.

## Next

- **Operations manifest codegen** — `@nxgt/ai-graphql/codegen`: a plugin that writes the operations manifest from your documents and `@nxgt/graphql-codegen-zod` variables schemas.

## Later

Nothing yet.

## Not planned

- **Letting the model write GraphQL** — the allow-list is the safety model.
- **A GraphQL client or HTTP transport** — tools run in process against your schema.
- **Subscriptions** — a tool call is one request and one answer.

## Shipped

Nothing yet. Releases are listed in `CHANGELOG.md`.
