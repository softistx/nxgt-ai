import type { z } from 'zod';
import { AiError, type AiIssue } from './errors';
import {
	assertObjectSchema,
	type JsonSchema,
	type ToolInputSchema,
	toInputSchema,
	zodIssues,
} from './schema';

/** What every `execute` receives beside the validated input. */
export interface ToolContext<TContext = unknown> {
	/** Whatever the application passed to the run: viewer, tenant, language. */
	context: TContext;
	/** Aborted when the run is; pass it to `fetch` and database calls. */
	signal: AbortSignal;
	/** The model's id for this call. */
	callId: string;
}

export type ToolValidation<TInput> =
	| { ok: true; value: TInput }
	| { ok: false; issues: AiIssue[] };

/** The shape the agent loop, the model adapters and servers consume. */
export interface Tool<TInput = unknown, TOutput = unknown, TContext = unknown> {
	readonly name: string;
	readonly description: string;
	/**
	 * A mutation: the loop proposes it for confirmation instead of running it.
	 * `executeTool` itself never checks the flag.
	 */
	readonly confirm: boolean;
	/** JSON Schema of the input, computed once. */
	readonly inputSchema: ToolInputSchema;
	/** Checks the output when set; the result carries the parsed value. */
	readonly outputSchema?: z.ZodType<TOutput>;
	validate(input: unknown): ToolValidation<TInput>;
	execute(
		input: TInput,
		tool: ToolContext<TContext>,
	): TOutput | PromiseLike<TOutput>;
}

/** Any tool, whatever its types; the type of a heterogeneous list. */
export type AnyTool = Tool<any, any, any>;

/** What a model is told about a tool. */
export interface ToolSpec {
	name: string;
	description: string;
	inputSchema: ToolInputSchema;
}

export const toolSpec = (tool: AnyTool): ToolSpec => ({
	name: tool.name,
	description: tool.description,
	inputSchema: tool.inputSchema,
});

// The limit common to the providers.
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function assertDefinition(name: string, description: string): void {
	if (!NAME.test(name)) {
		throw new AiError(
			'INVALID_TOOL_DEFINITION',
			`Tool name ${JSON.stringify(name)} is invalid: use 1 to 64 letters, digits, "_" or "-".`,
		);
	}
	if (description.trim() === '') {
		throw new AiError(
			'INVALID_TOOL_DEFINITION',
			`Tool "${name}" needs a description: the model reads it.`,
		);
	}
}

type OutputOf<O> = O extends z.ZodType ? z.input<O> : unknown;

export interface DefineToolOptions<
	S extends z.ZodType,
	O extends z.ZodType | undefined,
	TContext,
> {
	/** Letters, digits, `_` and `-`, at most 64. */
	name: string;
	/** Read by the model to decide when to call the tool. */
	description: string;
	/** An object schema; `.describe()` on fields reaches the model. */
	input: S;
	/** When set, `execute`'s return value is checked against it. */
	output?: O;
	/** Mark a mutation; default `false`. */
	confirm?: boolean;
	execute(
		input: z.output<S>,
		tool: ToolContext<TContext>,
	): OutputOf<O> | PromiseLike<OutputOf<O>>;
}

/** A tool whose input is a Zod schema: validated, and `execute` is typed by it. */
export function defineTool<
	S extends z.ZodType,
	O extends z.ZodType | undefined = undefined,
	TContext = unknown,
>(
	options: DefineToolOptions<S, O, TContext>,
): Tool<z.output<S>, O extends z.ZodType ? z.output<O> : unknown, TContext> {
	assertDefinition(options.name, options.description);
	const tool: Tool<z.output<S>, unknown, TContext> = {
		name: options.name,
		description: options.description,
		confirm: options.confirm ?? false,
		inputSchema: toInputSchema(options.input, options.name),
		validate(input) {
			const parsed = options.input.safeParse(input);
			return parsed.success
				? { ok: true, value: parsed.data }
				: { ok: false, issues: zodIssues(parsed.error) };
		},
		execute: options.execute,
		...(options.output ? { outputSchema: options.output } : {}),
	};
	return tool as Tool<
		z.output<S>,
		O extends z.ZodType ? z.output<O> : unknown,
		TContext
	>;
}

export interface JsonSchemaToolOptions<TInput, TContext> {
	name: string;
	description: string;
	/** JSON Schema of the input; its type must be `"object"`. */
	inputSchema: JsonSchema;
	confirm?: boolean;
	/** Checks the model's input; without it the input is passed through as sent. */
	validate?(input: unknown): ToolValidation<TInput>;
	execute(
		input: TInput,
		tool: ToolContext<TContext>,
	): unknown | PromiseLike<unknown>;
}

/**
 * A tool described by a JSON Schema you already have (a GraphQL operation, an
 * MCP tool). The package carries no JSON Schema validator: pass `validate`,
 * or the input reaches `execute` unchecked.
 */
export function jsonSchemaTool<TInput = unknown, TContext = unknown>(
	options: JsonSchemaToolOptions<TInput, TContext>,
): Tool<TInput, unknown, TContext> {
	assertDefinition(options.name, options.description);
	return {
		name: options.name,
		description: options.description,
		confirm: options.confirm ?? false,
		inputSchema: assertObjectSchema(options.inputSchema, options.name),
		validate:
			options.validate ?? ((input) => ({ ok: true, value: input as TInput })),
		execute: options.execute,
	};
}
