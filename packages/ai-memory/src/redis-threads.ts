import { MemoryError } from './errors';
import {
	assertOwner,
	type Ctx,
	evalLua,
	keys,
	ownThread,
	readThreadHash,
} from './redis-ctx';
import { toThread } from './redis-map';
import { CREATE_THREAD } from './redis-scripts';
import type { CreateThreadInput, Page, Thread, ThreadPage } from './types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const CURSOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createThread(
	c: Ctx,
	input: CreateThreadInput,
): Promise<Thread> {
	assertOwner(input.ownerId);
	const id = Bun.randomUUIDv7();
	const at = c.now();
	await evalLua(
		c,
		CREATE_THREAD,
		[keys.thread(c, id), keys.owner(c, input.ownerId)],
		[
			id,
			input.ownerId,
			String(at),
			c.expireAt(at),
			...(input.title === undefined ? [] : ['title', input.title]),
			...(input.meta === undefined ? [] : ['meta', JSON.stringify(input.meta)]),
		],
	);
	const hash = await readThreadHash(c, id);
	return toThread(id, hash ?? {});
}

export async function getThread(c: Ctx, id: string, ownerId: string) {
	const hash = await ownThread(c, id, ownerId);
	return hash ? toThread(id, hash) : undefined;
}

/**
 * Newest first, by id. The owner index can name a thread that has expired:
 * it is skipped and removed, and the page is filled from the ones after it.
 */
export async function listThreads(
	c: Ctx,
	ownerId: string,
	page: Page,
): Promise<ThreadPage> {
	assertOwner(ownerId);
	const limit = Math.min(Math.max(page.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
	if (page.cursor !== undefined && !CURSOR.test(page.cursor)) {
		throw new MemoryError(
			'INVALID_CURSOR',
			`"${page.cursor}" is not a cursor this store gave.`,
		);
	}
	const items: Thread[] = [];
	let from = page.cursor === undefined ? '+' : `(${page.cursor}`;
	while (items.length <= limit) {
		const ids = (await c.redis.send('ZRANGE', [
			keys.owner(c, ownerId),
			from,
			'-',
			'BYLEX',
			'REV',
			'LIMIT',
			'0',
			String(limit + 1 - items.length),
		])) as string[];
		if (ids.length === 0) break;
		for (const id of ids) {
			const hash = await readThreadHash(c, id);
			if (hash && hash['ownerId'] === ownerId) items.push(toThread(id, hash));
			else await c.redis.send('ZREM', [keys.owner(c, ownerId), id]);
		}
		from = `(${ids[ids.length - 1]}`;
	}
	const shown = items.slice(0, limit);
	const last = shown[shown.length - 1];
	return {
		items: shown,
		...(items.length > limit && last ? { nextCursor: last.id } : {}),
	};
}

/**
 * Messages and actions first, then the thread: a crash in between leaves an
 * empty thread that a retry removes, never messages nobody can reach.
 */
export async function deleteThread(c: Ctx, id: string, ownerId: string) {
	if (!(await ownThread(c, id, ownerId))) return false;
	const index = keys.actionIndex(c, id);
	const actions = (await c.redis.send('SMEMBERS', [index])) as string[];
	await c.redis.send('DEL', [
		keys.messages(c, id),
		keys.ids(c, id),
		index,
		...actions,
	]);
	await c.redis.send('DEL', [keys.thread(c, id)]);
	await c.redis.send('ZREM', [keys.owner(c, ownerId), id]);
	return true;
}
