---
'@nxgt/ai-graphql': patch
---

`graphqlTools` now throws `INVALID_OPTIONS` (naming the entry) for a `forbidFields` entry whose type or field is not in the schema, instead of accepting it and protecting nothing. The field must be declared by the named object or interface type itself. Configurations that listed a stale or mistyped entry, or a field named on an interface that only an implementing type declares, worked before and now fail at build time; correct or remove those entries.
