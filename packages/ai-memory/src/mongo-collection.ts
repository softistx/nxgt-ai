/** A BSON document as the store sees it. */
export type MongoDoc = Record<string, unknown>;

/** The cursor of `find`: only what the store chains. */
export interface MongoCursor {
	sort(spec: Record<string, 1 | -1>): MongoCursor;
	limit(count: number): MongoCursor;
	toArray(): Promise<MongoDoc[]>;
}

/**
 * The slice of a MongoDB collection the store uses. A `Collection` of the
 * `mongodb` driver, or a scoped collection of `@nxgt/mongo`, satisfies it as
 * is; this package imports no client.
 */
export interface MongoCollection {
	insertOne(doc: MongoDoc): Promise<unknown>;
	insertMany(docs: MongoDoc[]): Promise<unknown>;
	findOne(filter: MongoDoc): Promise<MongoDoc | null>;
	find(filter: MongoDoc): MongoCursor;
	/** Must resolve to the document, `returnDocument` picking which one (driver 6 and up). */
	findOneAndUpdate(
		filter: MongoDoc,
		update: MongoDoc,
		options: { returnDocument: 'before' | 'after' },
	): Promise<MongoDoc | null>;
	updateOne(
		filter: MongoDoc,
		update: MongoDoc,
	): Promise<{ matchedCount: number }>;
	deleteOne(filter: MongoDoc): Promise<{ deletedCount: number }>;
	deleteMany(filter: MongoDoc): Promise<unknown>;
}
