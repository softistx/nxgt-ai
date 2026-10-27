import { join } from 'node:path';
import {
	buildTestRedis,
	startTestRedis,
	type TestRedis,
} from '@nxgt/redis/testing';

/**
 * The Redis the specs run against, pinned (the default of `@nxgt/redis` moves
 * with its releases). CI keys the `.cache/redis` cache on this file, so
 * changing the version builds Redis once.
 */
export const REDIS_VERSION = '7.4.1';

/** The repository's git-ignored `.cache`, the directory CI caches. */
export const REDIS_CACHE = join(
	new URL('../../..', import.meta.url).pathname,
	'.cache',
	'redis',
);

const options = { version: REDIS_VERSION, downloadDir: REDIS_CACHE };

/**
 * A real Redis, one per spec file, on a free port. 23 ms once built; the
 * first build compiles it from source (about two minutes), which
 * `bun run build:redis` does before the suite.
 */
export function startRedis(): Promise<TestRedis> {
	return startTestRedis(options);
}

/** `bun run test/redis.ts`: builds the pinned Redis into the cache and exits. */
if (import.meta.main) {
	console.log(await buildTestRedis(options));
}
