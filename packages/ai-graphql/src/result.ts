import type { GraphQLError } from 'graphql';

/** One GraphQL error as the model reads it: a code, never a stack or a message. */
export interface ToolGraphqlError {
	/** `extensions.code`, or `INTERNAL_ERROR` when absent or not a plain code. */
	code: string;
	/** Response path of the failing field, when it has one. */
	path?: (string | number)[];
	/** `extensions.fields`: the input fields at fault. */
	fields?: string[];
	/** `extensions.params`: scalar values that explain the code (a limit, an id). */
	params?: Record<string, string | number | boolean>;
}

/** What a tool returns when the result fits `maxResultChars`. */
export interface GraphqlToolOutput {
	data?: unknown;
	/** Present only when the execution reported errors. */
	errors?: ToolGraphqlError[];
}

/** What replaces an output longer than `maxResultChars`. */
export interface TruncatedGraphqlOutput {
	truncated: true;
	/** The size of the whole result, serialised, in characters. */
	originalChars: number;
	/** The start of the result, serialised. */
	preview: string;
	/** A sentence for the model: the result was cut, narrow the variables. */
	note: string;
}

const CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Maps a GraphQL error to the part of it the model may see. */
export function toToolError(error: GraphQLError): ToolGraphqlError {
	const ext = error.extensions as Record<string, unknown> | undefined;
	const code =
		typeof ext?.['code'] === 'string' && CODE.test(ext['code'])
			? ext['code']
			: 'INTERNAL_ERROR';
	const out: ToolGraphqlError = { code };
	if (error.path?.length) out.path = [...error.path];
	const fields = ext?.['fields'];
	if (Array.isArray(fields) && fields.every((f) => typeof f === 'string')) {
		out.fields = fields.slice(0, 20);
	}
	const params = ext?.['params'];
	if (isRecord(params)) {
		const kept: Record<string, string | number | boolean> = {};
		for (const [k, v] of Object.entries(params).slice(0, 20)) {
			if (
				typeof v === 'number' ||
				typeof v === 'boolean' ||
				(typeof v === 'string' && v.length <= 200)
			) {
				kept[k] = v;
			}
		}
		if (Object.keys(kept).length) out.params = kept;
	}
	return out;
}

/** The output as is when its JSON fits `max`, else a truncation marker. */
export function fitOutput(
	output: GraphqlToolOutput,
	max: number,
): GraphqlToolOutput | TruncatedGraphqlOutput {
	const json = JSON.stringify(output) ?? '';
	if (json.length <= max) return output;
	return {
		truncated: true,
		originalChars: json.length,
		preview: json.slice(0, max),
		note: `The result was cut to ${max} of ${json.length} characters. Ask again with narrower variables (a filter, a smaller limit or page) or fewer fields.`,
	};
}
