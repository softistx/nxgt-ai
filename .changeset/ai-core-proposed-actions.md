---
'@nxgt/ai-core': minor
---

Add proposed actions: `confirm: true` tools are proposed by `runAgent` instead of run, with `proposalTtlMs` and `now` options, and `ProposedAction`, `toProposedAction`, `runConfirmedAction` and `rejectAction` (`ACTION_EXPIRED`, `ACTION_NOT_PENDING`) run or refuse them later. Add `estimateTokens`.
