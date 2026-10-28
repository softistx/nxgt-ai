---
'@nxgt/ai-ollama': minor
---

`providerOptions.options` now merges key by key over the mapped `temperature` and `num_predict`, instead of replacing them. New `numCtx` option sets `options.num_ctx`. Documented in the README, the guide and the troubleshooting page.
