---
'@nxgt/ai-graphql': minor
---

Add the `@nxgt/ai-graphql/codegen` subpath: a GraphQL Code Generator plugin that writes the operations manifest `graphqlTools` takes, one entry per query or mutation with its fragments, its description (graphql 17 description or a `# tool:` comment) and the `z<Op>Variables` schema of `@nxgt/graphql-codegen-zod`. Subscriptions, anonymous operations, duplicate names and missing descriptions fail generation with an error naming the operation.
