# @nxgt/ai-telemetry

An `@nxgt/ai-core` `AgentObserver` that writes an agent run as
[`@nxgt/telemetry`](https://www.npmjs.com/package/@nxgt/telemetry) spans with
`gen_ai.*` attributes. Peers: `@nxgt/ai-core`,
`@nxgt/telemetry`.

```ts
import { runAgent } from '@nxgt/ai-core';
import { aiTelemetry } from '@nxgt/ai-telemetry';

const run = runAgent({
	model,
	messages,
	tools,
	observers: [aiTelemetry()], // one observer can serve every run
});
```

One run gives one `ai.agent.run` span with an `ai.model.call` span per model
call and an `ai.tool.call` span per tool call under it. The spans go to the
telemetry in scope (`withTelemetry`) or installed, or to `aiTelemetry({
telemetry })`. With none, the run is untouched and nothing is emitted.

**Prompts, tool arguments, tool results and answers are never recorded by
default**; `aiTelemetry({ recordContent: true })` turns them on.

An abort is recorded as cancelled, not as an error; a failed model call or tool
call fails its span.

## Install

```sh
bun add @nxgt/ai-telemetry @nxgt/ai-core @nxgt/telemetry
```

Requires `"moduleResolution": "bundler"`. See the [guide](docs/guide/telemetry.md).

## Documentation

[docs/](docs/README.md): guides, [troubleshooting](docs/troubleshooting.md) and the [roadmap](docs/roadmap.md).
