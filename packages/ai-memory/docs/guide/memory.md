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

## Write your own store

Implement `MemoryStore` and run the contract suite against it:

```ts
import { memoryStoreContract } from '@nxgt/ai-memory/testing';

memoryStoreContract(() => myStore());
```

Your `updateAction` must be atomic in the backing database (a conditional
update on `status: 'pending'`), not a read then a write.
