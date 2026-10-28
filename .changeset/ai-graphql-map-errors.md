---
'@nxgt/ai-graphql': minor
---

feat: a `mapErrors(errors, { operation })` option decides what the model reads of the GraphQL errors of a tool call, since the server's own error formatting does not apply in process. Its result is cut down to `code`, `path`, `fields` and scalar `params`; a hook that throws or returns junk falls back to the default mapping. Application codes with `.` and `-` (`auth.errors.forbidden`, up to 100 characters) now reach the model instead of `INTERNAL_ERROR`. Closes #90.
