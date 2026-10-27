import { assertOwner, notFound } from './guards';

export { assertOwner, notFound };

/**
 * The one method the store calls: `RedisClient.send` of Bun, the client that
 * `connectRedis` and `openRedis` of `@nxgt/redis` hand out.
 */
export interface RedisCommands {
	send(command: string, args: string[]): Promise<unknown>;
}

/** What the functions of the sibling files share. */
export interface Ctx {
	redis: RedisCommands;
	prefix: string;
	now: () => number;
	/** The expiry as an epoch ms for a write at `at`, or `'0'` without a TTL. */
	expireAt: (at: number) => string;
}

/** The keys of one thread and of one owner. */
export const keys = {
	thread: (c: Ctx, id: string) => `${c.prefix}:thread:${id}`,
	messages: (c: Ctx, id: string) => `${c.prefix}:messages:${id}`,
	ids: (c: Ctx, id: string) => `${c.prefix}:ids:${id}`,
	actionIndex: (c: Ctx, id: string) => `${c.prefix}:actions:${id}`,
	owner: (c: Ctx, ownerId: string) => `${c.prefix}:owner:${ownerId}`,
	/**
	 * The prefix of an owner's action keys; the action id follows it. The
	 * owner's length comes first, so `a:b` + `c` never meets `a` + `b:c`.
	 */
	actionPrefix: (c: Ctx, ownerId: string) =>
		`${c.prefix}:action:${ownerId.length}:${ownerId}:`,
};

/** Runs a Lua script atomically. */
export function evalLua(
	c: Ctx,
	script: string,
	scriptKeys: readonly string[],
	args: readonly string[],
): Promise<unknown> {
	return c.redis.send('EVAL', [
		script,
		String(scriptKeys.length),
		...scriptKeys,
		...args,
	]);
}

/** The thread's fields as a Redis hash holds them, or `undefined` when absent. */
export async function readThreadHash(
	c: Ctx,
	id: string,
): Promise<Record<string, string> | undefined> {
	const raw = (await c.redis.send('HGETALL', [keys.thread(c, id)])) as
		| Record<string, string>
		| string[]
		| null;
	if (raw === null || raw === undefined) return undefined;
	if (Array.isArray(raw)) {
		const out: Record<string, string> = {};
		for (let i = 0; i + 1 < raw.length; i += 2) {
			out[raw[i] as string] = raw[i + 1] as string;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}
	return Object.keys(raw).length > 0 ? { ...raw } : undefined;
}

/** The owner's thread hash, or `undefined` when absent or another owner's. */
export async function ownThread(c: Ctx, id: string, ownerId: string) {
	assertOwner(ownerId);
	const hash = await readThreadHash(c, id);
	return hash && hash['ownerId'] === ownerId ? hash : undefined;
}
