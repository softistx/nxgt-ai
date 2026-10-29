# Roadmap

A direction, not a commitment. See the [repository roadmap](https://github.com/softistx/nxgt-ai/blob/develop/docs/roadmap.md) for the whole SDK.

## Now

- **Operation codes on a failed call** — a failed operation's error codes are on the result's `error.details`, not only in the message ([#102](https://github.com/softistx/nxgt-ai/issues/102)).

## Next

Nothing yet.

## Later

- **Error options that always name the operation** — every error code except an invalid-options error would carry its operation in the type ([#72](https://github.com/softistx/nxgt-ai/issues/72)).

## Not planned

- **Letting the model write GraphQL** — the allow-list is the safety model.
- **A GraphQL client or HTTP transport** — tools run in process against your schema.
- **Subscriptions** — a tool call is one request and one answer.

## Shipped

- **`mapErrors`** — choose what the model reads of a call's errors (the server's error formatting does not apply in process), and application codes with `.` and `-` pass ([#90](https://github.com/softistx/nxgt-ai/issues/90)).

- **`@nxgt/ai-graphql` 0.1.0** — GraphQL as agent tools:
  - `graphqlTools`: an allow-list of operations (name, description, Zod variables) as `@nxgt/ai-core` tools, run in process with graphql-js.
  - `forbidFields` checked at build, fragments included, with a typed error naming the operation and the field path.
  - Mutations behind a confirmation, GraphQL errors as codes, and results cut to `maxResultChars`.
  - `@nxgt/ai-graphql/codegen`: a graphql-codegen plugin that writes the operations manifest, with one entry per query or mutation, its fragments and its variables schema, and clear errors for a missing description, a subscription or a duplicate.

Releases are listed in `CHANGELOG.md`.
