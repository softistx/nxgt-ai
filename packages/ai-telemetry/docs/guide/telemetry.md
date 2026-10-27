# Agent telemetry

`aiTelemetry(options)` returns an `AgentObserver`. Pass it in `observers` and
the run is written as spans through `@nxgt/telemetry`.

```ts
import { runAgent } from '@nxgt/ai-core';
import { aiTelemetry } from '@nxgt/ai-telemetry';
import { createTelemetry, consoleExporter } from '@nxgt/telemetry';

const telemetry = createTelemetry('assistant', {
	exporters: [consoleExporter()],
});

const run = runAgent({
	model,
	messages,
	observers: [aiTelemetry({ telemetry })],
});
await run.result;
await telemetry.close();
```

## Options

| Option          | Default                       | Meaning                                                         |
| --------------- | ----------------------------- | --------------------------------------------------------------- |
| `telemetry`     | the one in scope or installed | where the spans go; with none anywhere, nothing is emitted      |
| `recordContent` | `false`                       | also record prompts, tool arguments and results, and the answer |

Build **one observer per `runAgent` call**: ai-core's hooks carry no run id, so
the observer keeps the state of a single run. If the run happens inside a span
(a request), `ai.agent.run` nests under it.

## Spans

```
ai.agent.run
├─ ai.model.call   (step 1)
├─ ai.tool.call    (one per tool call, in parallel when the model asks for several)
└─ ai.model.call   (step 2)
```

Each child opens when the work starts (`onModelStart`, `onToolStart`) and
closes when its outcome is known, so its duration is the real one. A tool's own
code does not run inside its `ai.tool.call` span: spans a tool opens nest under
whatever span was current where the tool was called, not under the tool call.

## Attributes

| Span            | Attributes                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all model spans | `gen_ai.provider.name`, `gen_ai.system` (older backends), `gen_ai.request.model`                                                                                      |
| `ai.agent.run`  | `gen_ai.operation.name` = `invoke_agent`, `ai.agent.tools`, `ai.agent.steps`, `ai.agent.reason`, usage summed over the run                                            |
| `ai.model.call` | `gen_ai.operation.name` = `chat`, `ai.step`, `ai.duration_ms`, `gen_ai.response.finish_reasons` (`stop`, `tool_calls`, `length`, `content_filter`), usage of the call |
| `ai.tool.call`  | `gen_ai.operation.name` = `execute_tool`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `ai.step`, `ai.duration_ms`                                                      |

Usage is `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
`gen_ai.usage.cache_read.input_tokens` and
`gen_ai.usage.cache_creation.input_tokens`.

## Content

By default no prompt, tool argument, tool result or answer is recorded: spans
carry names, ids, counts and timings only. With `recordContent: true`:

| Span           | Attribute                                                        |
| -------------- | ---------------------------------------------------------------- |
| `ai.agent.run` | `gen_ai.input.messages`, `gen_ai.output.messages` (JSON strings) |
| `ai.tool.call` | `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result` (JSON)   |

Turn it on only where the data may be stored: prompts and tool results can hold
personal data.

## Errors and aborts

| What happened                    | Span status                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| tool result with `isError`       | `ai.tool.call` is `error`, `ai.error.code` is the tool code |
| model call failed                | `ai.model.call` and `ai.agent.run` are `error`              |
| run ends `max-steps` or `budget` | `ai.agent.run` is `error` with `ai.error.code`              |
| the run is aborted               | the open spans are `cancelled`, not `error` (`ABORTED`)     |

A tool that fails does not fail the run: the model sees the error result and
`ai.agent.run` stays `ok` unless the run itself ends in error.

## Testing

Use a `Telemetry` with a collecting exporter and `fakeModel` from
`@nxgt/ai-testing`; see `src/observer.spec.ts`.
