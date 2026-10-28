---
'@nxgt/ai-anthropic': patch
---

Overriding `thinking` through `providerOptions` is now treated like the typed option: `temperature` is dropped, a `budget_tokens` below 1024 is raised, and `max_tokens` is resized for the budget, each unless `providerOptions` names that key. Documented in the README, the guide and the troubleshooting page.
