# Conversation memory

A `MemoryStore` keeps threads (a conversation each) and their messages. Every
method takes the `ownerId` and sees only that owner's data.

## Threads

```ts
const t = await store.createThread({
	ownerId: 'u1',
	title: 'Billing',
	meta: { channel: 'web' },
});
await store.getThread(t.id, 'u1'); // the thread, or undefined
await store.deleteThread(t.id, 'u1'); // true; removes messages and actions too
```

`ownerId` must be a non-empty string, else `MemoryError('INVALID_OWNER')`.

### Paging

`listThreads(ownerId, { limit, cursor })` returns the newest thread first. Pass
the `nextCursor` of a page to get the next one; the last page has none.

```ts
let page = await store.listThreads('u1', { limit: 20 });
while (true) {
	show(page.items);
	if (!page.nextCursor) break;
	page = await store.listThreads('u1', { limit: 20, cursor: page.nextCursor });
}
```

The default limit is 20 and the cap 100. A cursor is opaque: pass only what
the store gave, else `MemoryError('INVALID_CURSOR')`.

## Messages

`append` validates each message against `messageSchema` (an `@nxgt/ai-core`
`Message`) and returns them stored, with an `id` and a 1-based `seq`.

```ts
await store.append(t.id, 'u1', [
	{ role: 'user', parts: [{ type: 'text', text: 'Cancel my plan' }] },
]);
const { messages } =
	(await store.load(t.id, 'u1', { sinceSummary: false })) ?? {};
```

`load` returns `undefined` for an absent or foreign thread.

## Summary

`setSummary(threadId, ownerId, { text, throughMessageId, tokens })` records a
rolling summary of the messages up to `throughMessageId`. `load` with
`sinceSummary: true` then returns the summary and only the messages after it;
with `false` it returns them all.

## Compaction

`compact` keeps a long thread under a token budget. It first cuts the tool
results, oldest first, and stops as soon as the thread fits; if it still does
not fit, it folds the oldest messages into a rolling summary and keeps the last
`keepLast` (6) messages. A tool call and its result are never split: the cut
moves back to keep both.

```ts
import { estimateTokens } from '@nxgt/ai-core';
import { compact, summarizeWith } from '@nxgt/ai-memory';

const loaded = await store.load(threadId, ownerId, { sinceSummary: true });
if (!loaded) throw new Error('thread not found');
const out = await compact(loaded.messages, {
	budget: 8000,
	summary: loaded.summary, // folded into the next summary
	summarize: summarizeWith(model), // a ModelAdapter from @nxgt/ai-core
});
if (out.summary && out.throughMessageId) {
	await store.setSummary(threadId, ownerId, {
		text: out.summary,
		throughMessageId: out.throughMessageId,
		tokens: estimateTokens(out.summary),
	});
}
// send `loaded.summary` or `out.summary`, then `out.messages`, to the model
```

- `messages` are the thread's messages after its stored summary. `compact`
  returns `{ summary?, throughMessageId?, messages, tokens }`: `summary` and
  `throughMessageId` are set only when this call folded messages; `tokens` is
  the estimate of the kept summary and `messages`.
- A cut tool output becomes `{ truncated: true, originalChars, preview }`
  (`preview` is the first `truncateToolResultsTo` characters, default 2000). Error
  results are left as they are. The store keeps the originals: only the
  returned copy is cut.
- `estimate` defaults to `estimateTokens` of `@nxgt/ai-core`, a rough count;
  pass a provider's counter for a tight budget. A thread is under budget when
  its tokens are at most `budget`.
- `summarizeWith(model, { system?, maxTokens?, signal? })` calls the model
  once, with a transcript of the messages (the previous summary first), and
  returns its text. Pass your own `summarize` to use another way.
- The kept messages start on a user turn: the cut moves back past assistant
  and tool messages, as the Anthropic Messages API needs a conversation that
  opens with the user and refuses a tool result without its call. When no user
  turn lies before the cut, the cut stays where it keeps call and result
  together and the tail may start on another role.
- `compact` throws `MemoryError('EMPTY_SUMMARY')` when `summarize` returns an
  empty or whitespace-only string, and folds nothing, so a blank summary is
  never stored.
- Send the summary in the system prompt, never as a message of its own, so the
  request keeps opening with the user's turn:

```ts
const summary = out.summary ?? loaded.summary?.text;
await generate(model, {
	system: [
		{ text: basePrompt },
		...(summary
			? [{ text: `Summary of the earlier conversation:\n${summary}` }]
			: []),
	],
	messages: out.messages.map((m) => m.message),
});
```

- Compacting again an already compacted thread (its tail and stored summary)
  changes nothing while it fits.

## Proposed actions

When an appended message holds a `proposed-action` part, the store records a
`pending` action you can find by its id.

```ts
const action = await store.findAction(actionId, 'u1');
const won = await store.updateAction(actionId, 'u1', { status: 'confirmed' });
if (!won) return; // absent, or someone else confirmed or rejected it first
await runConfirmedAction(/* ... */);
```

`updateAction` changes the action only while it is `pending` (a
compare-and-set), so two concurrent confirmations cannot both run the tool.
Patch `status` to `confirmed`, `rejected`, `expired` or `failed`, with the
tool's `result` when there is one.

## MongoDB store

`mongoMemory` from `@nxgt/ai-memory/mongo` stores threads and messages in two
collections you give it. The collections only need `insertOne`, `insertMany`,
`findOne`, `find` (with `sort`, `limit`, `toArray`), `findOneAndUpdate`,
`updateOne`, `deleteOne` and `deleteMany`: a `mongodb` driver `Collection`
(version 6 or later) has them, and so does a scoped collection of `@nxgt/mongo`.

```ts
import { mongoMemory } from '@nxgt/ai-memory/mongo';

const store = mongoMemory({
	threads: db.collection('threads'),
	messages: db.collection('messages'),
});
```

### Indexes

Create them once; the store does not.

```ts
import { messageIndexes, threadIndexes } from '@nxgt/ai-memory/mongo';

for (const { key, ...options } of threadIndexes) {
	await db.collection('threads').createIndex(key, options);
}
for (const { key, ...options } of messageIndexes) {
	await db.collection('messages').createIndex(key, options);
}
```

The messages' unique index on `ownerId, threadId, seq` is what keeps two
appends from sharing a position.

### Stored fields

`threadFields` and `messageFields` list the fields of each document, for
projections, migrations or a schema validator. `_id` is the thread or message
id (a time-ordered UUID, which is what pages `listThreads` newest first).
Every message document also carries its `ownerId`, and a message that proposes
actions carries an `actions` array with their current status.

### Expiry

`expireAfterSeconds` makes the store write an `expiresAt` date, and a thread
expires as one unit: each write (`append`, `setSummary`) moves the thread and
all its messages to that long after the write, so a load never starts with a
tool result whose call is gone. Create `expiresAtIndex` on both collections so MongoDB deletes them.

```ts
import { expiresAtIndex } from '@nxgt/ai-memory/mongo';

const threads = db.collection('threads');
const messages = db.collection('messages');

await threads.createIndex(expiresAtIndex.key, { expireAfterSeconds: 0 });
await messages.createIndex(expiresAtIndex.key, { expireAfterSeconds: 0 });
const store = mongoMemory({
	threads,
	messages,
	expireAfterSeconds: 30 * 86400,
});
```

MongoDB removes expired documents about once a minute, so they can be read for
a little after their time. A thread that is not written to for that long is
removed whole.

### Concurrency

`append` reserves its `seq` range with one atomic increment on the thread, so
concurrent appends never collide. `updateAction` is one `findOneAndUpdate`
that matches only an action still `pending`; of two concurrent confirmations
one gets the action and the other `undefined`. A failed insert in `append`
leaves a gap in `seq`; `load` still orders by it.

#### Deleting

`deleteThread` deletes the messages, then the thread, then the messages again.
It returns `false` for a foreign or absent owner. A crash in between leaves an
empty thread, which a retry removes. An `append` racing a delete checks the
thread after its insert and removes its own batch, throwing
`THREAD_NOT_FOUND`; for a moment its messages can still be read by id.

## Redis store

`redisMemory` from `@nxgt/ai-memory/redis` stores threads and messages in Redis
keys. Give it the client of `@nxgt/redis`: the `client` of a `connectRedis`
connection, or of an instance of `openRedis`. The store calls only
`client.send(command, args)`, so it opens no connection of its own and closes
nothing. It needs Redis 6.2 or later, and a single node or a replica set with
Sentinel: Redis Cluster is not supported, because one script touches several
keys.

```ts
import { connectRedis } from '@nxgt/redis';
import { redisMemory } from '@nxgt/ai-memory/redis';

const redis = await connectRedis(process.env.REDIS_URL ?? 'redis://localhost');
const store = redisMemory({ client: redis.client });
```

### Keys

Every key starts with `prefix` (default `ai-memory`); give each application
that shares a Redis its own.

| key                                  | type       | holds                                                                  |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------- |
| `<prefix>:thread:<id>`               | hash       | the thread: `ownerId`, `title`, `meta`, `messageCount`, `summary`, ... |
| `<prefix>:messages:<id>`             | sorted set | the messages of a thread, scored by `seq`                              |
| `<prefix>:ids:<id>`                  | hash       | message id to `seq`, to find the summary's last message                |
| `<prefix>:actions:<id>`              | set        | the keys of the actions the thread proposed                            |
| `<prefix>:action:<n>:<ownerId>:<id>` | hash       | one proposed action: its `status`, its `body` and its `result`         |
| `<prefix>:owner:<ownerId>`           | sorted set | the ids of the owner's threads, which pages `listThreads` newest first |

`<n>` is the length of the owner id, so owner ids may hold `:` without their action keys meeting. Thread ids are time-ordered UUIDs. Reads need no index and no setup.

### Expiry

`expireAfterSeconds` sets an expiry on a thread's keys at every write that
touches the thread (`append`, `setSummary`): the thread, its messages and its
indexes go together, that long after the last write, and so do its
proposed actions (`updateAction` slides them too). Unlike the Mongo store,
messages do not expire one by one: the whole thread expires from its last
write, so a thread you keep writing to never expires and an idle one
disappears whole. The `now` option is the clock the expiry is computed from.

Redis deletes an expired key on access or in the background; a read after
the time never sees it. The owner index is not given an expiry: `listThreads`
skips the ids of expired threads and removes them as it goes.

### Concurrency

`append` is one Lua script: it checks the owner, reserves the `seq` range with
an atomic increment, and writes the messages and the new actions, so
concurrent appends never share a position and a reader never sees a gap.
`updateAction` is one script that matches only an action still `pending`; of
two concurrent confirmations one gets the action and the other `undefined`. An
action id is recorded once per owner, as in the other stores.

### Deleting

`deleteThread` is one script: it removes the messages, the actions, the thread
and its entry in the owner index together, and returns `false` for a foreign
or absent owner. It never leaves unreachable keys; an `append` racing it
finds the thread gone and throws `THREAD_NOT_FOUND`.

## Write your own store

Implement `MemoryStore` and run the contract suite against it:

```ts
import { memoryStoreContract } from '@nxgt/ai-memory/testing';

memoryStoreContract(() => myStore());
```

Your `updateAction` must be atomic in the backing database (a conditional
update on `status: 'pending'`), not a read then a write.
