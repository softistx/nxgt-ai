---
'@nxgt/ai-anthropic': patch
---

Overriding `thinking` through `providerOptions` now resizes `max_tokens` for its `budget_tokens`, as the typed option does, unless `providerOptions` names `max_tokens`. Documented in the README, the guide and the troubleshooting page.
