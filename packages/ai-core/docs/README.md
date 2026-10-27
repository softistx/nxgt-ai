# `@nxgt/ai-core` documentation

Messages, usage, zod-typed tools and the model port for agents on Bun. The
agent loop runs them, and mutations wait for a confirmation.

| Page                                 | Read it when                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Messages](guide/messages.md)        | you build or store a conversation: `Message`, the five `Part` types, `Usage`, `addUsage`                                                           |
| [Tools](guide/tools.md)              | you give a model something to call: `defineTool`, `jsonSchemaTool`, `confirm`, the JSON Schema it sends, `executeTool`, the context and the signal |
| [Model port](guide/model.md)         | you write a provider adapter or call a model: `ModelAdapter`, `ModelRequest`, `ModelEvent`, `generate`, abort, `agentEventSchema`                  |
| [Agent loop](guide/agent.md)         | you run a conversation with tools: `runAgent`, events, limits, abort, observers, `AgentResult`                                                     |
| [Proposed actions](guide/actions.md) | a tool changes data: `confirm`, `ProposedAction`, `runConfirmedAction`, expiry, `estimateTokens`                                                   |
| [Errors](guide/errors.md)            | you handle a failure: `AiError`, its codes, and which ones a tool result carries                                                                   |
| [Roadmap](roadmap.md)                | you want to know what is coming                                                                                                                    |

The [README](../README.md) is the short version.
