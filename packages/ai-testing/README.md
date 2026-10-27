# @nxgt/ai-testing

Deterministic tests for nxgt-ai agents: a scripted `fakeModel` and `collect`.
Peer: `@nxgt/ai-core`; no other dependency.

```ts
import { collect, expectToolCalls, fakeModel, textOf } from '@nxgt/ai-testing';

const model = fakeModel([
	{ toolCalls: [{ name: 'weather', input: { city: 'Lyon' } }] },
	{ text: 'It is 18 degrees.', chunk: 5 },
]);

// run an agent on `model`, then:
const events = await collect(run); // an AsyncIterable of events, or { events }
expectToolCalls(events, [{ name: 'weather', input: { city: 'Lyon' } }]);
textOf(events); // 'It is 18 degrees.'
model.requests; // every ModelRequest the agent sent, tools included
```

## Install

```sh
bun add -d @nxgt/ai-testing @nxgt/ai-core
```

Requires `"moduleResolution": "bundler"`. See the [guide](docs/guide/testing.md).

## Documentation

[docs/](docs/README.md): guides, [troubleshooting](docs/troubleshooting.md) and the [roadmap](docs/roadmap.md).
