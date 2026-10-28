---
'@nxgt/ai-core': minor
---

`ProposedActionStatus` gains `running`, the claim of an action before it runs. `runConfirmedAction` accepts a `pending` or `running` action (a claimed action is not checked against its expiry again), and `actionOutcomeMessage` refuses a `running` action like a `pending` one. The guide documents the claim, run, record flow.
