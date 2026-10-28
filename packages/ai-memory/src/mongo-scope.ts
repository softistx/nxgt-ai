import { MemoryError } from './errors';
import type { MongoDoc } from './mongo-collection';
import { messageFields, threadFields } from './mongo-fields';

/** A value the driver compares by value: a primitive or a BSON value such as an `ObjectId`. */
export type MongoScopeValue =
	| string
	| number
	| boolean
	| { readonly _bsontype: string };

/** The tenant fields of a store: field name to the value it must hold. */
export type MongoScope = Readonly<Record<string, MongoScopeValue>>;

const reserved = new Set<string>([
	...Object.values(threadFields),
	...Object.values(messageFields),
]);

const bad = (message: string) => new MemoryError('INVALID_SCOPE', message);

function isScopeValue(value: unknown): value is MongoScopeValue {
	if (typeof value === 'string') return true;
	if (typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { _bsontype?: unknown })._bsontype === 'string'
	);
}

/**
 * Checks the scope once, at construction, and returns a frozen copy. A field
 * the store writes itself, an operator or a path cannot be a scope field, and
 * a value must be a primitive or a BSON value: a plain object or an array
 * would turn the filter into an operator query.
 */
export function checkScope(scope: MongoScope | undefined): MongoDoc {
	if (scope === undefined) return {};
	const copy: MongoDoc = {};
	for (const [key, value] of Object.entries(scope)) {
		if (key === '' || key.startsWith('$') || key.includes('.')) {
			throw bad(`Scope field "${key}" is not a plain field name.`);
		}
		if (reserved.has(key)) {
			throw bad(`Scope field "${key}" is written by the store itself.`);
		}
		if (!isScopeValue(value)) {
			throw bad(
				`Scope field "${key}" must be a string, a finite number, a boolean or a BSON value such as an ObjectId.`,
			);
		}
		copy[key] = value;
	}
	return Object.freeze(copy);
}
