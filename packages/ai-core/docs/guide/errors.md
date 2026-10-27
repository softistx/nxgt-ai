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
	readonly cause?: unknown;
}
```

| Code                      | Raised or reported when                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `INVALID_TOOL_DEFINITION` | thrown by `defineTool` / `jsonSchemaTool`: bad name, empty description, input schema not an object |
| `INVALID_TOOL_INPUT`      | a tool result: the model's input failed validation; `issues` locate each problem                   |
| `INVALID_TOOL_OUTPUT`     | a tool result: the return value failed the `output` schema                                         |
| `TOOL_FAILED`             | a tool result: `execute` threw                                                                     |

These codes exist for the next slices and are not raised yet: `UNKNOWN_TOOL`,
`MODEL_ERROR`, `RATE_LIMITED`, `AUTHENTICATION`, `ABORTED`, `MAX_STEPS`,
`BUDGET_EXCEEDED`. More codes can be added in a minor version, so keep a
`default` branch when you switch on `code`.

In a tool result the same information is plain data, `{ code, message,
issues? }`, because it is sent to the model and stored with the conversation.
