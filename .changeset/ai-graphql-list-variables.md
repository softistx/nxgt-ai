---
'@nxgt/ai-graphql': patch
---

fix: variables written by `@nxgt/graphql-codegen-zod` for a list (a list variable, or an input object holding a list) now work as tool input. The model sees a JSON Schema array with typed items instead of `graphqlTools` throwing "Custom types cannot be represented in JSON Schema". Validation is unchanged, and other unrepresentable schemas still fail at build, now as `GraphqlToolsError` `INVALID_OPERATION`.
