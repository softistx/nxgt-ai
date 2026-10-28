# @nxgt/ai-graphql

## 0.2.1

### Patch Changes

- Updated dependencies [[`62fac94`](https://github.com/softistx/nxgt-ai/commit/62fac94e52e4cc8a4c5dd5379b2968b5af3ff611)]:
  - @nxgt/ai-core@0.3.0

## 0.2.0

### Minor Changes

- [#91](https://github.com/softistx/nxgt-ai/pull/91) [`e041093`](https://github.com/softistx/nxgt-ai/commit/e041093e4038184bbd9b4e93de35ca6341d747e7) Thanks [@SteveGT96](https://github.com/SteveGT96)! - `graphqlTools` now throws `INVALID_OPTIONS` (naming the entry) for a `forbidFields` entry whose type or field is not in the schema, instead of accepting it and protecting nothing. The field must be declared by the named object or interface type itself. Configurations that listed a stale or mistyped entry, or a field named on an interface that only an implementing type declares, worked before and now fail at build time; correct or remove those entries.

## 0.1.0

### Minor Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - A `GraphqlOperation` may carry `summarize(variables)`, passed to its mutation tool as the proposed action's summary.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `@nxgt/ai-graphql/codegen` subpath: a GraphQL Code Generator plugin that writes the operations manifest `graphqlTools` takes, one entry per query or mutation with its fragments, its description (graphql 17 description or a `# tool:` comment) and the `z<Op>Variables` schema of `@nxgt/graphql-codegen-zod`. Subscriptions, anonymous operations, duplicate names and missing descriptions fail generation with an error naming the operation.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add `graphqlTools({ schema, operations, context?, forbidFields?, maxResultChars? })`: allow-listed GraphQL operations (name, description, Zod variables) become `@nxgt/ai-core` tools run in process with graphql-js. `forbidFields` is checked at build through fragments (`GraphqlToolsError` `FORBIDDEN_FIELD`), mutations get `confirm: true`, GraphQL errors reach the model as codes, and results are cut to `maxResultChars`.

### Patch Changes

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Take the `z<Op>Variables` schema names from `@nxgt/graphql-codegen-zod/naming` instead of a mirrored copy of its rules. `./codegen` now needs `@nxgt/graphql-codegen-zod` `>=0.4.0 <0.5.0` (optional peer, installed anyway to generate the zod schemas); the `change-case` peer is gone.

- [#65](https://github.com/softistx/nxgt-ai/pull/65) [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc) Thanks [@SteveGT96](https://github.com/SteveGT96)! - Add the `INVALID_OPTIONS` code to `GraphqlToolsError`, thrown for a bad `forbidFields` entry or `maxResultChars` in place of `INVALID_OPERATION` with an empty `operation`; `operation` is now `undefined` for it.
- Updated dependencies [[`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc), [`ee9324f`](https://github.com/softistx/nxgt-ai/commit/ee9324ffcf12842f7b33e39838a6da8d669f37bc)]:
  - @nxgt/ai-core@0.2.0
