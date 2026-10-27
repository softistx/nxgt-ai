import { z } from 'zod';
import { AiError, type AiIssue } from './errors';

export interface JsonSchema {
	type?: unknown;
	[key: string]: unknown;
}

/** The object schema of a tool's input, as providers receive it. */
export interface ToolInputSchema extends JsonSchema {
	type: 'object';
}

/**
 * JSON Schema for what a model must send: the schema's input side
 * (`io: 'input'`), so defaults and transforms do not leak, and no `$schema`.
 */
export function toInputSchema(
	schema: z.ZodType,
	tool: string,
): ToolInputSchema {
	const { $schema: _dropped, ...json } = z.toJSONSchema(schema, {
		io: 'input',
		unrepresentable: 'throw',
	}) as JsonSchema;
	return assertObjectSchema(json, tool);
}

export function assertObjectSchema(
	schema: JsonSchema,
	tool: string,
): ToolInputSchema {
	if (schema.type !== 'object') {
		throw new AiError(
			'INVALID_TOOL_DEFINITION',
			`Tool "${tool}": the input schema must describe an object (type "object"), not ${JSON.stringify(schema.type ?? null)}.`,
		);
	}
	return schema as ToolInputSchema;
}

export function zodIssues(error: z.ZodError): AiIssue[] {
	return error.issues.map((issue) => ({
		path: issue.path.map(String).join('.'),
		message: issue.message,
	}));
}
