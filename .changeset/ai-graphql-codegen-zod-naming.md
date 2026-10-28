---
'@nxgt/ai-graphql': patch
---

Take the `z<Op>Variables` schema names from `@nxgt/graphql-codegen-zod/naming` instead of a mirrored copy of its rules. `./codegen` now needs `@nxgt/graphql-codegen-zod` `>=0.4.0 <0.5.0` (optional peer, installed anyway to generate the zod schemas); the `change-case` peer is gone.
