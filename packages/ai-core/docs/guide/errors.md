# Errors

`AiError` is the one error this package raises of its own. It extends `Error`.

```ts
import { AiError } from '@nxgt/ai-core';

try {
	defineTool({
		name: 'bad name',
		description: 'x',
		input: z.object({}),
		execute: () => 1,
	});
} catch (error) {
	if (error instanceof AiError) console.error(error.code, error.message);
}
```

```ts
class AiError extends Error {
	readonly code: AiErrorCode;
	readonly issues: readonly { path: string; message: string }[]; // [] unless input was invalid
	readonly details: readonly ToolErrorDetail[]; // [] unless the tool gave its own reasons
	readonly cause?: unknown;
}
```

| Code                      | Raised or reported when                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `INVALID_TOOL_DEFINITION` | thrown by `defineTool` / `jsonSchemaTool`: bad name, empty description, input schema not an object             |
| `INVALID_TOOL_INPUT`      | a tool result: the model's input failed validation; `issues` locate each problem                               |
| `INVALID_TOOL_OUTPUT`     | a tool result: the return value failed the `output` schema                                                     |
| `TOOL_FAILED`             | a tool result: `execute` threw                                                                                 |
| `ACTION_EXPIRED`          | thrown by `runConfirmedAction` / `rejectAction`: the action's `expiresAt` has passed                           |
| `ACTION_NOT_PENDING`      | thrown by the same: the action is already running (for `rejectAction`), confirmed, rejected, expired or failed |
| `INVALID_REQUEST`         | thrown by a model adapter: the request contradicts itself and cannot be sent                                   |

These codes exist for the next slices and are not raised yet: `UNKNOWN_TOOL`,
`MODEL_ERROR`, `RATE_LIMITED`, `AUTHENTICATION`, `ABORTED`, `MAX_STEPS`,
`BUDGET_EXCEEDED`. More codes can be added in a minor version, so keep a
`default` branch when you switch on `code`.

`AI_ERROR_CODES` lists every code; `AiErrorCode` is its element type. The
`error` event and tool-result errors that `agentEventSchema` validates accept
any string code, so a client older than the server still parses a newer code:
`WireErrorCode` (`AiErrorCode | (string & {})`) types the `code` of those
events, of `RunError` and of tool-result errors, and `WireRunEndReason` does the
same for `done.reason`. Keep a `default` branch when you switch on them. The
thrown `AiError.code` stays strictly `AiErrorCode`.

In a tool result the same information is plain data, `{ code, message,
issues?, details? }`, because it is sent to the model and stored with the
conversation.

**`details`** is how a tool reports its own reasons without the SDK parsing a
message: `new AiError('TOOL_FAILED', message, { details: [{ code:
'auth.errors.forbidden', fields: ['id'], params: { max: 5 } }] })`. Each entry
is a `ToolErrorDetail` (`code`, and optionally `path`, `fields`, scalar
`params`). The error cleans them (`cleanErrorDetails`: plain codes of letters,
digits, `_`, `.`, `-` up to 100, at most 50 entries, 20 fields, 20 params), and
`errorResult` copies them to `error.details` only when there are some. The
result's `code` stays `TOOL_FAILED`; read `error.details?.[0]?.code` for the
tool's reason. `@nxgt/ai-graphql` fills it for a failed operation, and
`@nxgt/ai-memory` stores it with a failed action. `agentEventSchema` keeps `details` too, cleaned again by `cleanErrorDetails`.
