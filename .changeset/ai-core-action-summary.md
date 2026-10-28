---
'@nxgt/ai-core': minor
'@nxgt/ai-graphql': minor
---

Add `summarize(input)` to `defineTool` and `jsonSchemaTool`: a short line for the confirmation UI that fills `ProposedActionPart.summary` (also `ProposedAction.summary`; a throwing `summarize` leaves it out). Add `actionOutcomeMessage(action, { reason? })`, which turns a confirmed, rejected, failed or expired action into a user text message that tells the model the outcome in a later request framed as an application event, with the summary and reason as JSON strings and the tool output in a `<tool-output>` data block, cut without splitting a surrogate (error code only, never error text). `@nxgt/ai-graphql`: a `GraphqlOperation` may carry `summarize(variables)`.
