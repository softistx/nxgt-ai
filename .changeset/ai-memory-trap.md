---
'@nxgt/ai-memory': patch
---

Document the trap of appending parts from a client's request body (a forged `proposed-action` becomes an action anyone can confirm): append only the user's text plus `run.result.messages`.
