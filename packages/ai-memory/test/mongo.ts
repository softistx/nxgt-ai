import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

/**
 * The mongod the specs run against, pinned (the memory server's own default
 * moves between its minor releases). CI keys the `.cache/mongodb` cache on
 * this file, so changing the version downloads the binary once.
 */
export const MONGOD_VERSION = '8.2.6';

/** The repository's git-ignored `.cache`, the directory CI caches. */
export const MONGOD_CACHE = join(
	new URL('../../..', import.meta.url).pathname,
	'.cache',
	'mongodb',
);

export interface TestMongo {
	client: MongoClient;
	/** A fresh, empty database. */
	fresh(): Promise<ReturnType<MongoClient['db']>>;
	stop(): Promise<void>;
}

/**
 * A real MongoDB, one per spec file, as a single-node replica set. About
 * 300 ms once the binary is cached, 25 s the first time (the download).
 */
export async function startMongo(): Promise<TestMongo> {
	const replSet = await MongoMemoryReplSet.create({
		replSet: { count: 1, storageEngine: 'wiredTiger' },
		binary: { version: MONGOD_VERSION, downloadDir: MONGOD_CACHE },
		// 10 seconds is the default, and a cold CI runner takes longer.
		instanceOpts: [{ launchTimeout: 60_000 }],
	});
	const client = await MongoClient.connect(replSet.getUri());
	let n = 0;
	return {
		client,
		fresh: async () => {
			const db = client.db(`memory-${++n}-${crypto.randomUUID().slice(0, 8)}`);
			await db.dropDatabase();
			return db;
		},
		stop: async () => {
			await client.close();
			await replSet.stop({ doCleanup: true });
		},
	};
}
