# Troubleshooting

- [`MemoryError` THREAD_NOT_FOUND](#memoryerror-thread_not_found)
- [`MemoryError` MESSAGE_NOT_FOUND](#memoryerror-message_not_found)
- [`MemoryError` INVALID_CURSOR](#memoryerror-invalid_cursor)
- [`MemoryError` INVALID_OWNER](#memoryerror-invalid_owner)
- [`updateAction` returns undefined](#updateaction-returns-undefined)

## `MemoryError` THREAD_NOT_FOUND

**When:** `append` or `setSummary` throws `Thread "…" was not found.`
**Why:** the thread does not exist, was deleted, or belongs to another owner; the store does not tell these apart.
**Fix:** check the `ownerId` is the one that created the thread.

```ts
const thread = await store.getThread(id, ownerId);
if (!thread) return notFound();
```

## `MemoryError` MESSAGE_NOT_FOUND

**When:** `setSummary` throws `Message "…" is not in thread "…".`
**Why:** `throughMessageId` is not the `id` of a message of that thread.
**Fix:** use an `id` returned by `append` or `load`, not a `seq`.

## `MemoryError` INVALID_CURSOR

**When:** `listThreads` throws `"…" is not a cursor this store gave.`
**Why:** the cursor was edited, or came from another store.
**Fix:** pass back the `nextCursor` of the previous page unchanged.

## `MemoryError` INVALID_OWNER

**When:** any call throws `ownerId must be a non-empty string.`
**Why:** the owner id is empty or missing, which would put every caller in one scope.
**Fix:** resolve the signed-in user before calling the store.

## `updateAction` returns undefined

**When:** you confirm an action and get `undefined`.
**Why:** the action is absent, belongs to another owner, or is no longer `pending` because a concurrent call or an earlier one already settled it.
**Fix:** treat it as "not yours to run": do not execute the tool. Call `findAction` to see the status.

## `compact` returns more tokens than `budget`

It happens when the last `keepLast` messages (default 6), or a tool call and the
result kept with it, are alone over the budget. `compact` never drops them. Lower
`keepLast`, lower `truncateToolResultsTo`, or raise `budget`.

```ts
await compact(messages, {
	budget,
	keepLast: 2,
	truncateToolResultsTo: 500,
	summarize,
});
```

## The summary forgets what the previous one said

`compact` only knows the earlier summary when you give it. Pass the thread's
stored one as `summary`.

```ts
const loaded = await store.load(id, ownerId, { sinceSummary: true });
await compact(loaded.messages, { budget, summary: loaded.summary, summarize });
```

## The model sees `{ truncated: true, preview }` as a tool result

That is a tool output cut by `compact` because it was longer than
`truncateToolResultsTo` characters. The stored message is unchanged. Raise
`truncateToolResultsTo`, or have the tool return less.

## `MemoryError` EMPTY_SUMMARY

`summarize` returned an empty or whitespace-only string, so `compact` folded
nothing rather than let a blank summary replace the messages. Check the model's
reply (a refusal or a `maxTokens` too low gives no text) and retry.

```ts
try {
	await compact(messages, { budget, summarize });
} catch (e) {
	if (e instanceof MemoryError && e.code === 'EMPTY_SUMMARY') retryLater();
	else throw e;
}
```

## Mongo store: `E11000 duplicate key` on `ownerId_1_threadId_1_seq_1`

**When:** `append` on the Mongo store fails with a duplicate key error.
**Why:** two documents got the same `seq` in a thread: the messages were written by something other than the store, or `messageCount` of the thread was changed by hand.
**Fix:** let only the store write these collections. Set the thread's `messageCount` to the highest `seq` of its messages again.

```ts
const last = await messages
	.find({ threadId })
	.sort({ seq: -1 })
	.limit(1)
	.toArray();
await threads.updateOne(
	{ _id: threadId },
	{ $set: { messageCount: last[0]?.seq ?? 0 } },
);
```

## Mongo store: expired threads and messages are still read

**When:** a thread past its `expireAfterSeconds` still loads.
**Why:** MongoDB's TTL monitor runs about once a minute, and it only runs for a collection that has `expiresAtIndex`.
**Fix:** create `expiresAtIndex` on both collections (see the guide), and do not rely on the exact second of expiry.

## Mongo store: `findOneAndUpdate` returns a result object, not a document

**When:** `append` stores `NaN` as a `seq`, or `updateAction` returns `undefined` for a pending action that exists.
**Why:** the collection resolves `findOneAndUpdate` to `{ value }`, as `mongodb` 5 and earlier do; the store needs the document itself.
**Fix:** use `mongodb` 6 or later, or wrap the collection so `findOneAndUpdate` resolves to the document.
