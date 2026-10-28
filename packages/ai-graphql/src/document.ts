import {
	type DocumentNode,
	type GraphQLSchema,
	Kind,
	type OperationDefinitionNode,
	parse,
	print,
	validate,
	visit,
} from 'graphql';
import { GraphqlToolsError } from './errors';
import { assertNoForbiddenFields } from './forbid';
import type { GraphqlOperation } from './graphql-tools';

export function parseDocument(op: GraphqlOperation): DocumentNode {
	try {
		// A caller's DocumentNode is copied, so changing it later changes nothing.
		return parse(
			typeof op.document === 'string' ? op.document : print(op.document),
		);
	} catch (cause) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${op.name}" does not parse: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ operation: op.name, cause },
		);
	}
}

export function pickOperation(
	op: GraphqlOperation,
	document: DocumentNode,
): OperationDefinitionNode {
	const ops = document.definitions.filter(
		(d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
	);
	const found =
		op.operationName === undefined
			? ops.length === 1
				? ops[0]
				: undefined
			: ops.find((o) => o.name?.value === op.operationName);
	if (!found) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			ops.length > 1 || op.operationName !== undefined
				? `Operation "${op.name}": set operationName to one of the document's operations.`
				: `Operation "${op.name}": the document holds no operation.`,
			{ operation: op.name },
		);
	}
	if (found.operation === 'subscription') {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${op.name}" is a subscription; only queries and mutations become tools.`,
			{ operation: op.name },
		);
	}
	return found;
}

export function assertNoIncremental(
	op: GraphqlOperation,
	document: DocumentNode,
) {
	visit(document, {
		Directive(node) {
			if (node.name.value === 'defer' || node.name.value === 'stream') {
				throw new GraphqlToolsError(
					'INVALID_OPERATION',
					`Operation "${op.name}" uses @${node.name.value}; incremental delivery is not supported.`,
					{ operation: op.name },
				);
			}
		},
	});
}

/**
 * Parses (a copy of) the operation's document, picks the operation and checks
 * it against the schema and the forbidden fields; throws `GraphqlToolsError`.
 */
export function compileOperation(
	op: GraphqlOperation,
	schema: GraphQLSchema,
	forbidden: ReadonlySet<string>,
): { document: DocumentNode; node: OperationDefinitionNode } {
	const document = parseDocument(op);
	const node = pickOperation(op, document);
	assertNoIncremental(op, document);
	const problems = validate(schema, document);
	if (problems.length > 0) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${op.name}" is not valid against the schema: ${problems.map((p) => p.message).join('; ')}`,
			{ operation: op.name },
		);
	}
	assertNoForbiddenFields(schema, document, node, forbidden, op.name);
	return { document, node };
}
