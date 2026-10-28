import { type AnyTool, jsonSchemaTool, type ToolContext } from '@nxgt/ai-core';
import {
	type DocumentNode,
	execute,
	GraphQLError,
	type GraphQLSchema,
} from 'graphql';
import { z } from 'zod';
import { compileOperation } from './document';
import { GraphqlToolsError } from './errors';
import { parseForbidden } from './forbid';
import { variablesIssues, variablesJsonSchema } from './input-schema';
import {
	failure,
	fitOutput,
	type GraphqlToolOutput,
	internalFailure,
	type MapErrors,
	mapToolErrors,
	rootsAllNull,
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
	/**
	 * One line for the confirmation UI, from the validated variables; used when
	 * the operation is a mutation. See `summarize` on `defineTool`.
	 */
	summarize?(variables: Record<string, unknown>): string;
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
	/**
	 * Decides what the model reads of the errors of one call, since the schema
	 * runs in process and the server's own error formatting does not apply.
	 * Receives the `GraphQLError`s and `{ operation }` (the tool name); returns
	 * the errors to show, each `{ code, path?, fields?, params? }`. The result is
	 * cut down to those four, a code must be letters, digits, `_`, `.` or `-` (at
	 * most 100), and a hook that throws or returns anything else falls back to
	 * the default mapping. Default: `extensions.code`, `fields` and scalar
	 * `params`, never a message.
	 */
	mapErrors?: MapErrors;
}

export const DEFAULT_MAX_RESULT_CHARS = 20_000;

const NO_VARIABLES = z.object({});

function buildTool<TContext>(
	op: GraphqlOperation,
	options: GraphqlToolsOptions<TContext>,
	forbidden: ReadonlySet<string>,
	max: number,
): AnyTool {
	const { document, node } = compileOperation(op, options.schema, forbidden);
	const operationName = node.name?.value;
	const input = op.variables ?? NO_VARIABLES;
	return jsonSchemaTool<Record<string, unknown>, TContext>({
		name: op.name,
		description: op.description,
		inputSchema: variablesJsonSchema(input, op.name),
		validate(raw) {
			const parsed = input.safeParse(raw);
			return parsed.success
				? { ok: true, value: parsed.data as Record<string, unknown> }
				: { ok: false, issues: variablesIssues(parsed.error) };
		},
		confirm: node.operation === 'mutation',
		...(op.summarize ? { summarize: op.summarize } : {}),
		async execute(variables, tool) {
			tool.signal.throwIfAborted();
			let contextValue: unknown = tool.context;
			if (options.context) {
				try {
					contextValue = await options.context(tool);
				} catch (cause) {
					tool.signal.throwIfAborted();
					throw internalFailure(cause);
				}
			}
			let result: Awaited<ReturnType<typeof execute>>;
			try {
				result = await execute({
					schema: options.schema,
					document,
					variableValues: variables,
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
			const mapped = errors?.length
				? mapToolErrors(errors, options.mapErrors, { operation: op.name })
				: undefined;
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
				throw internalFailure(cause);
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
	const forbidden = parseForbidden(options.forbidFields ?? [], options.schema);
	const max = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
	if (!Number.isInteger(max) || max < 100) {
		throw new GraphqlToolsError(
			'INVALID_OPTIONS',
			'maxResultChars must be an integer of at least 100: a truncation marker needs room.',
			{},
		);
	}
	if (
		options.mapErrors !== undefined &&
		typeof options.mapErrors !== 'function'
	) {
		throw new GraphqlToolsError(
			'INVALID_OPTIONS',
			'mapErrors must be a function.',
			{},
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
