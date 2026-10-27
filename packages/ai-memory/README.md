# @nxgt/ai-memory

Conversation memory for [`@nxgt/ai-core`](../ai-core) agents: a `MemoryStore`
port scoped by owner on every call, an in-process store, and a contract suite
to test your own stores. Peers: `@nxgt/ai-core`, `zod`.

```ts
import { memoryStore } from '@nxgt/ai-memory';

const store = memoryStore();
const thread = await store.createThread({ ownerId: 'user-1', title: 'Trip' });

await store.append(thread.id, 'user-1', [
	{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
]);

const loaded = await store.load(thread.id, 'user-1', { sinceSummary: true });
// loaded.messages feed runAgent({ messages: loaded.messages.map((m) => m.message) })
```

Another owner's thread is invisible: `getThread` and `load` return
`undefined`, `findAction` and `updateAction` find nothing, and writes raise
`MemoryError('THREAD_NOT_FOUND')`.

`updateAction` is a compare-and-set on `pending`: of two concurrent
confirmations of one proposed action, one gets the action back and the other
gets `undefined`.

## Compact a long thread

```ts
import { estimateTokens } from '@nxgt/ai-core';
import { compact, summarizeWith } from '@nxgt/ai-memory';

const loaded = await store.load(threadId, ownerId, { sinceSummary: true });
if (!loaded) throw new Error('thread not found');
const out = await compact(loaded.messages, {
	budget: 8000,
	summary: loaded.summary,
	summarize: summarizeWith(model),
});
if (out.summary && out.throughMessageId) {
	await store.setSummary(threadId, ownerId, {
		text: out.summary,
		throughMessageId: out.throughMessageId,
		tokens: estimateTokens(out.summary),
	});
}
```

Tool results are cut first (oldest first), then the oldest messages are folded
into a rolling summary; the last 6 are kept and a tool call never loses its result.

## MongoDB store

`@nxgt/ai-memory/mongo` keeps threads and messages in two collections. It takes
any object with the few collection methods it calls: a `Collection` of the
`mongodb` driver, or a scoped collection of `@nxgt/mongo`. It imports no client.
It needs the `mongodb` driver 6 or later.

```ts
import {
	expiresAtIndex,
	messageIndexes,
	mongoMemory,
	threadIndexes,
} from '@nxgt/ai-memory/mongo';

// Once, at start-up: the indexes the store relies on.
for (const { key, ...options } of [...threadIndexes, expiresAtIndex]) {
	await db.collection('threads').createIndex(key, options);
}
for (const { key, ...options } of [...messageIndexes, expiresAtIndex]) {
	await db.collection('messages').createIndex(key, options);
}

const store = mongoMemory({
	threads: db.collection('threads'),
	messages: db.collection('messages'),
	expireAfterSeconds: 60 * 60 * 24 * 30, // optional; omit it to keep everything
});
```

It passes `memoryStoreContract`. `updateAction` is one atomic write that
matches only a `pending` action. Without `expireAfterSeconds`, leave
`expiresAtIndex` out. See the [guide](docs/guide/memory.md#mongodb-store).

## Redis store

`@nxgt/ai-memory/redis` keeps threads and messages in Redis keys. It takes the
client of [`@nxgt/redis`](https://www.npmjs.com/package/@nxgt/redis) (the
`client` of `connectRedis` or of an `openRedis` instance) and calls only its
`send` method. It needs Redis 6.2 or later, not in cluster mode.

```ts
import { connectRedis } from '@nxgt/redis';
import { redisMemory } from '@nxgt/ai-memory/redis';

const redis = await connectRedis('redis://localhost:6379');

const store = redisMemory({
	client: redis.client,
	prefix: 'support-chat', // optional; default "ai-memory"
	expireAfterSeconds: 60 * 60 * 24 * 30, // optional; omit it to keep everything
});

const thread = await store.createThread({ ownerId: 'user-1' });
await store.append(thread.id, 'user-1', [
	{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
]);
```

It passes `memoryStoreContract`. Each `append` is one Lua script that reserves
its `seq` range and writes its messages, and `updateAction` is one script that
matches only a `pending` action; `deleteThread` is one script. Nothing is indexed by hand and nothing needs
creating first. See the [guide](docs/guide/memory.md#redis-store).

## Test your own store

```ts
// my-store.spec.ts
import { memoryStoreContract } from '@nxgt/ai-memory/testing';

memoryStoreContract(() => myStore());
```

The factory returns a fresh, empty store each time. The suite runs under
`bun test`.

## API

| Export                                                                                             | What it is                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MemoryStore`                                                                                      | the port: `createThread`, `getThread`, `listThreads`, `append`, `load`, `setSummary`, `findAction`, `updateAction`, `deleteThread`, each with the `ownerId` |
| `memoryStore({ now? })`                                                                            | an in-process store; `now` is the clock in epoch ms                                                                                                         |
| `compact(messages, { budget, summarize, keepLast?, truncateToolResultsTo?, summary?, estimate? })` | cuts old tool results, then folds the oldest messages into a summary; returns `{ summary?, throughMessageId?, messages, tokens }`                           |
| `summarizeWith(model, { system?, maxTokens?, signal? })`                                           | a `summarize` for `compact` backed by an `@nxgt/ai-core` model adapter                                                                                      |
| `MemoryError`, `MEMORY_ERROR_CODES`                                                                | the error of a failed write; `code` is `THREAD_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `INVALID_CURSOR`, `INVALID_OWNER` or `EMPTY_SUMMARY`                        |
| `messageSchema`, `threadSchema`, `storedMessageSchema`, `summarySchema`                            | the zod shapes of a message, a thread, a stored message and a summary                                                                                       |
| `mongoMemory({ threads, messages, expireAfterSeconds?, now? })`                                    | from `@nxgt/ai-memory/mongo`: a store over two MongoDB collections                                                                                          |
| `threadFields`, `messageFields`, `threadIndexes`, `messageIndexes`, `expiresAtIndex`               | from `@nxgt/ai-memory/mongo`: the stored field names and the indexes to create                                                                              |
| `redisMemory({ client, prefix?, expireAfterSeconds?, now? })`                                      | from `@nxgt/ai-memory/redis`: a store over Redis keys                                                                                                       |
| `RedisMemoryOptions`                                                                               | from `@nxgt/ai-memory/redis`: the options of `redisMemory`                                                                                                  |
| `RedisCommands`                                                                                    | from `@nxgt/ai-memory/redis`: the one method of the client the store calls, `send(command, args)`                                                           |
| `memoryStoreContract(make)`                                                                        | from `@nxgt/ai-memory/testing`: the suite a store must pass, next to `memoryStore`                                                                          |

## Traps

- Mongo store: create the indexes first (a missing unique index is not caught), and mind that a TTL monitor deletes expired documents up to a minute late.
- Redis store: unlike the Mongo store, messages do not expire one by one; the whole thread expires from its last write (plus `expireAfterSeconds`), and it needs Redis 6.2 or later outside cluster mode.
- A foreign owner reads as absent, never as forbidden.
- `updateAction` returns `undefined` when the action is absent, foreign or no longer `pending`.
- The store never checks `expiresAt`; the core checks it when the action is confirmed.
- A cursor is opaque: pass only a `nextCursor` the store gave.
- `load` with `sinceSummary` returns every message when the summary's `throughMessageId` is no longer found.
- `compact` still returns more than `budget` when the kept messages alone are over it; raise `budget` or lower `keepLast`.
- A cut tool output is replaced by `{ truncated: true, originalChars, preview }` in the returned copy only; the store keeps the original.
- The summary is not a message: send it in the system prompt (see the guide). The kept messages start on a user turn when the thread has one before the cut.
- Pass the stored `summary` to `compact`, or the next summary forgets the previous one.
- `append` strips keys a message part does not declare.

## Install

```sh
bun add @nxgt/ai-memory @nxgt/ai-core zod
```

Requires `"moduleResolution": "bundler"`. This package is not published yet.
See the [guide](docs/guide/memory.md).

## Documentation

See [docs/](docs/README.md): the guide, troubleshooting and the roadmap.
