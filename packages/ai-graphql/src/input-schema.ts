import type { AiIssue, JsonSchema, ToolInputSchema } from '@nxgt/ai-core';
import { z } from 'zod';
import { GraphqlToolsError } from './errors';

type Def = { type: string; [key: string]: unknown };
type Node = { _zod: { def: Def } };

const defOf = (schema: unknown): Def => (schema as Node)._zod.def;

/**
 * `@nxgt/graphql-codegen-zod` writes a list as
 * `z.union([z.array(z.custom()), z.custom().transform(v => [v])]).pipe(z.array(item))`:
 * it accepts a single value where GraphQL allows one. A model sends arrays, and
 * `z.custom` has no JSON Schema, so the schema shown to the model is the
 * pipe's output side, `z.array(item)`. Returns the two `z.custom` of the
 * coercion when `schema` is that pipe, else `undefined`.
 */
function coercionCustoms(schema: unknown): unknown[] | undefined {
	const def = defOf(schema);
	if (def.type !== 'pipe') return undefined;
	const input = defOf(def['in']);
	if (input.type !== 'union') return undefined;
	const [many, one] = input['options'] as unknown[];
	if (!many || !one || defOf(many).type !== 'array') return undefined;
	const element = defOf(many)['element'];
	const single = defOf(one);
	if (
		defOf(element).type !== 'custom' ||
		single.type !== 'pipe' ||
		defOf(single['in']).type !== 'custom' ||
		defOf(single['out']).type !== 'transform' ||
		defOf(def['out']).type !== 'array'
	) {
		return undefined;
	}
	return [element, single['in']];
}

/**
 * The JSON Schema of a tool's variables, as a model must send them: lists
 * written by `@nxgt/graphql-codegen-zod` become plain arrays whose items keep
 * their schema. Every other schema Zod cannot represent still throws, as for
 * any tool; the validation itself is the Zod schema's, unchanged.
 */
export function variablesJsonSchema(
	schema: z.ZodType,
	operation: string,
): ToolInputSchema {
	const stray = new Set<unknown>();
	let json: JsonSchema;
	try {
		json = z.toJSONSchema(schema, {
			io: 'input',
			unrepresentable: ({ zodSchema, message }) => {
				if (defOf(zodSchema).type !== 'custom') throw new Error(message);
				stray.add(zodSchema);
				return 'any';
			},
			override(ctx) {
				const customs = coercionCustoms(ctx.zodSchema);
				if (!customs) return;
				for (const custom of customs) stray.delete(custom);
				const { $schema: _s, ...items } = z.toJSONSchema(
					(ctx.zodSchema as unknown as { _zod: { def: { out: z.ZodType } } })
						._zod.def.out,
					{ io: 'input', unrepresentable: 'any' },
				) as JsonSchema;
				for (const key of Object.keys(ctx.jsonSchema))
					delete ctx.jsonSchema[key];
				Object.assign(ctx.jsonSchema, items);
			},
		}) as JsonSchema;
	} catch (cause) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${operation}": the variables schema cannot become a JSON Schema (${cause instanceof Error ? cause.message : String(cause)}).`,
			{ operation, cause },
		);
	}
	if (stray.size > 0) {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${operation}": a variables schema holds a z.custom that is not a codegen list coercion, which has no JSON Schema.`,
			{ operation },
		);
	}
	const { $schema: _dropped, ...rest } = json;
	if (rest.type !== 'object') {
		throw new GraphqlToolsError(
			'INVALID_OPERATION',
			`Operation "${operation}": variables must be a Zod object schema.`,
			{ operation },
		);
	}
	return rest as ToolInputSchema;
}

export function variablesIssues(error: z.ZodError): AiIssue[] {
	return error.issues.map((issue) => ({
		path: issue.path.map(String).join('.'),
		message: issue.message,
	}));
}
