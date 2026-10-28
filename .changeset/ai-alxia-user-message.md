---
'@nxgt/ai-alxia': minor
---

Add `userMessageSchema` (and the `UserMessage` type): the zod shape of a user message in a request body, `role: 'user'` and text parts only, so a forged `proposed-action` part never reaches a memory store. The README and guide gain the trap.
