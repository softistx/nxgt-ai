import {
	type DocumentNode,
	type FragmentDefinitionNode,
	type GraphQLCompositeType,
	type GraphQLNamedType,
	type GraphQLSchema,
	getNamedType,
	isAbstractType,
	isCompositeType,
	isInterfaceType,
	isObjectType,
	Kind,
	type OperationDefinitionNode,
	type SelectionSetNode,
} from 'graphql';
import { GraphqlToolsError } from './errors';

/** The `Type.field` names of a list, checked to be well formed. */
export function parseForbidden(list: readonly string[]): Set<string> {
	const set = new Set<string>();
	for (const entry of list) {
		if (!/^[_A-Za-z][_0-9A-Za-z]*\.[_A-Za-z][_0-9A-Za-z]*$/.test(entry)) {
			throw new GraphqlToolsError(
				'INVALID_OPERATION',
				`forbidFields entry ${JSON.stringify(entry)} must look like "Type.field".`,
				{ operation: '' },
			);
		}
		set.add(entry);
	}
	return set;
}

// Every type whose `field` could be what the selection reads: the type itself,
// the interfaces it implements, and (on an abstract type) its possible types.
function candidates(
	schema: GraphQLSchema,
	parent: GraphQLCompositeType,
): string[] {
	const names = [parent.name];
	if (isObjectType(parent) || isInterfaceType(parent)) {
		for (const i of parent.getInterfaces()) names.push(i.name);
	}
	if (isAbstractType(parent)) {
		for (const t of schema.getPossibleTypes(parent)) {
			names.push(t.name);
			for (const i of t.getInterfaces()) names.push(i.name);
		}
	}
	return names;
}

interface Walk {
	schema: GraphQLSchema;
	forbidden: ReadonlySet<string>;
	fragments: ReadonlyMap<string, FragmentDefinitionNode>;
	operation: string;
}

function walk(
	ctx: Walk,
	set: SelectionSetNode,
	parent: GraphQLCompositeType,
	path: readonly string[],
	stack: readonly string[],
): void {
	for (const sel of set.selections) {
		if (sel.kind === Kind.FIELD) {
			const name = sel.name.value;
			if (name.startsWith('__')) continue;
			const key = sel.alias?.value ?? name;
			const here = [...path, key];
			const hit = candidates(ctx.schema, parent)
				.map((t) => `${t}.${name}`)
				.find((f) => ctx.forbidden.has(f));
			if (hit) {
				const via = stack.length
					? ` (through fragment ${stack.join(' > ')})`
					: '';
				throw new GraphqlToolsError(
					'FORBIDDEN_FIELD',
					`Operation "${ctx.operation}" selects the forbidden field ${hit} at ${here.join('.')}${via}.`,
					{ operation: ctx.operation, field: hit, path: here.join('.') },
				);
			}
			const def =
				isObjectType(parent) || isInterfaceType(parent)
					? parent.getFields()[name]
					: undefined;
			const child: GraphQLNamedType | undefined = def
				? getNamedType(def.type)
				: undefined;
			if (sel.selectionSet && child && isCompositeType(child)) {
				walk(ctx, sel.selectionSet, child, here, stack);
			}
		} else if (sel.kind === Kind.INLINE_FRAGMENT) {
			const cond = sel.typeCondition
				? ctx.schema.getType(sel.typeCondition.name.value)
				: parent;
			if (cond && isCompositeType(cond)) {
				walk(ctx, sel.selectionSet, cond, path, stack);
			}
		} else {
			const name = sel.name.value;
			const frag = ctx.fragments.get(name);
			if (!frag || stack.includes(name)) continue;
			const cond = ctx.schema.getType(frag.typeCondition.name.value);
			if (cond && isCompositeType(cond)) {
				walk(ctx, frag.selectionSet, cond, path, [...stack, name]);
			}
		}
	}
}

/**
 * Throws `FORBIDDEN_FIELD` when the operation selects, directly, in a nested
 * selection, in a fragment or in an inline fragment, a field of `forbidden`.
 * A field forbidden on an interface is also forbidden on the types that
 * implement it, and one forbidden on a type is caught when read through an
 * interface or union that type belongs to.
 */
export function assertNoForbiddenFields(
	schema: GraphQLSchema,
	document: DocumentNode,
	op: OperationDefinitionNode,
	forbidden: ReadonlySet<string>,
	operation: string,
): void {
	if (forbidden.size === 0) return;
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const def of document.definitions) {
		if (def.kind === Kind.FRAGMENT_DEFINITION)
			fragments.set(def.name.value, def);
	}
	const root =
		op.operation === 'query'
			? schema.getQueryType()
			: op.operation === 'mutation'
				? schema.getMutationType()
				: schema.getSubscriptionType();
	if (!root) return;
	walk(
		{ schema, forbidden, fragments, operation },
		op.selectionSet,
		root,
		[],
		[],
	);
}
