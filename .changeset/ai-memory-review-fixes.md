---
'@nxgt/ai-memory': patch
---

Fix the deep-review findings: the Mongo store now expires a thread as one unit (each write moves every message to the thread's `expiresAt`, so a load never starts with an orphan tool result and the summary cut survives), an `append` racing `deleteThread` removes its own batch and throws `THREAD_NOT_FOUND`, and `summarizeWith` frames the transcript as tagged data blocks with error codes instead of error messages.
