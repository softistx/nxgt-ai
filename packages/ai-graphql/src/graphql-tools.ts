import {
	AiError,
	type AnyTool,
	defineTool,
	type ToolContext,
} from '@nxgt/ai-core';
import {
	type DocumentNode,
	execute,
	GraphQLError,
	type GraphQLSchema,
	Kind,
	type OperationDefinitionNode,
	parse,
	print,
	validate,
	visit,
} from 'graphql';
import { z } from 'zod';
import { GraphqlToolsError } from './errors';
import { assertNoForbiddenFields, parseForbidden } from './forbid';
import {
	fitOutput,
	type GraphqlToolOutput,
	type ToolGraphqlError,
	toToolError,
} from './result';

/**
 * One allow-listed operation. This is the shape `@nxgt/ai-graphql/codegen`
 * will emit as a manifest: `variables` is the generated `z<Op>Variables`.
 */
export interface GraphqlOperation {
	/** The tool name: letters, digits, `_` and `-`, at most 64. */
	name: string;
	/** Read by the model to decide when to call the tool. */
	description: string;
	/** The operation, as source text or a parsed document (fragments included). */
	document: string | DocumentNode;
	/** A Zod object schema of the operation's variables; default: no variables. */
	variables?: z.ZodObject;
	/** Which operation of the document to run when it holds several. */
	operationName?: string;
}

export interface GraphqlToolsOptions<TContext = unknown> {
	/** Executable schema, resolvers included; the operations run against it. */
	schema: GraphQLSchema;
	/** The allow-list: nothing outside it is reachable by the model. */
	operations: readonly GraphqlOperation[];
	/**
	 * Builds the GraphQL context of one call from the tool context (the run's
	 * `context`, the abort signal). Default: the run's `context` as is.
	 */
	context?: (tool: ToolContext<TContext>) => unknown | PromiseLike<unknown>;
	/** `Type.field` names no operation may select; checked when building. */
	forbidFields?: readonly string[];
	/** Longest serialised result handed to the model; default 20000. */
	maxResultChars?: number;
}

export const DEFAULT_MAX_RESULT_CHARS = 20_000;

const NO_VARIABLES = z.object({});

function parseDocument(op: GraphqlOperation): DocumentNode {
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

function pickOperation(
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

function assertNoIncremental(op: GraphqlOperation, document: DocumentNode) {
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

const rootsAllNull = (data: unknown): boolean =>
	typeof data === 'object' &&
	data !== null &&
	Object.values(data).every((v) => v === null);

function failure(errors: readonly ToolGraphqlError[]): AiError {
	return new AiError(
		'TOOL_FAILED',
		`The GraphQL operation failed: ${JSON.stringify(errors)}`,
	);
}

function buildTool<TContext>(
	op: GraphqlOperation,
	options: GraphqlToolsOptions<TContext>,
	forbidden: ReadonlySet<string>,
	max: number,
): AnyTool {
	const document = parseDocument(op);
	const node = pickOperation(op, document);
	assertNoIncremental(op, document);
	const problems = validate(options.schema, document);
	if (problems.length > 0) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${op.name}" is not valid against the schema: ${problems.map((p) => p.message).join('; ')}`,
			{ operation: op.name },
		);
	}
	assertNoForbiddenFields(options.schema, document, node, forbidden, op.name);
	const operationName = node.name?.value;
	return defineTool({
		name: op.name,
		description: op.description,
		input: op.variables ?? NO_VARIABLES,
		confirm: node.operation === 'mutation',
		async execute(variables, tool: ToolContext<TContext>) {
			tool.signal.throwIfAborted();
			let contextValue: unknown = tool.context;
			if (options.context) {
				try {
					contextValue = await options.context(tool);
				} catch (cause) {
					tool.signal.throwIfAborted();
					throw new AiError(
						'TOOL_FAILED',
						`The GraphQL operation failed: ${JSON.stringify([{ code: 'INTERNAL_ERROR' }])}`,
						{ cause },
					);
				}
			}
			let result: Awaited<ReturnType<typeof execute>>;
			try {
				result = await execute({
					schema: options.schema,
					document,
					variableValues: variables as Record<string, unknown>,
					contextValue,
					...(operationName === undefined ? {} : { operationName }),
				});
			} catch (error) {
				tool.signal.throwIfAborted();
				// Never the message: it can carry internals.
				throw failure([
					error instanceof GraphQLError
						? toToolError(error)
						: { code: 'INTERNAL_ERROR' },
				]);
			}
			const { data, errors } = result as {
				data?: unknown;
				errors?: readonly GraphQLError[];
			};
			const mapped = errors?.map(toToolError);
			if (
				mapped?.length &&
				(node.operation === 'mutation' ||
					data === null ||
					data === undefined ||
					rootsAllNull(data))
			) {
				throw failure(mapped);
			}
			const output: GraphqlToolOutput = {
				data,
				...(mapped?.length ? { errors: mapped } : {}),
			};
			try {
				return fitOutput(output, max);
			} catch (cause) {
				// BigInt or a cycle in the data: not serialisable.
				throw new AiError(
					'TOOL_FAILED',
					`The GraphQL operation failed: ${JSON.stringify([{ code: 'INTERNAL_ERROR' }])}`,
					{ cause },
				);
			}
		},
	});
}

/**
 * Turns allow-listed GraphQL operations into tools for `runAgent`, executed in
 * process against `schema` with graphql-js. Each operation is parsed, checked
 * against the schema and scanned for `forbidFields` when this is called; a
 * problem throws `GraphqlToolsError` here, never while an agent runs. A
 * mutation becomes a tool with `confirm: true`; a query runs directly.
 */
export function graphqlTools<TContext = unknown>(
	options: GraphqlToolsOptions<TContext>,
): AnyTool[] {
	const forbidden = parseForbidden(options.forbidFields ?? []);
	const max = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
	if (!Number.isInteger(max) || max < 100) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			'maxResultChars must be an integer of at least 100: a truncation marker needs room.',
			{ operation: '' },
		);
	}
	const seen = new Set<string>();
	return options.operations.map((op) => {
		if (seen.has(op.name)) {
			throw new GraphqlToolsError(
				'DUPLICATE_OPERATION',
				`Two operations are named "${op.name}".`,
				{ operation: op.name },
			);
		}
		seen.add(op.name);
		return buildTool(op, options, forbidden, max);
	});
}
