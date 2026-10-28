---
'@nxgt/ai-graphql': minor
---

Add `graphqlTools({ schema, operations, context?, forbidFields?, maxResultChars? })`: allow-listed GraphQL operations (name, description, Zod variables) become `@nxgt/ai-core` tools run in process with graphql-js. `forbidFields` is checked at build through fragments (`GraphqlToolsError` `FORBIDDEN_FIELD`), mutations get `confirm: true`, GraphQL errors reach the model as codes, and results are cut to `maxResultChars`.
