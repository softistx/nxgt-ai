import { AiError, cleanErrorDetails } from '@nxgt/ai-core';
import type { GraphQLError } from 'graphql';

/** One GraphQL error as the model reads it: a code, never a stack or a message. */
export interface ToolGraphqlError {
	/** `extensions.code`, or `INTERNAL_ERROR` when absent or not a plain code
	 * (letters, digits, `_`, `.`, `-`; at most 100). */
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

/** Letters, digits, `_`, `.` and `-`: `NOT_FOUND`, `auth.errors.forbidden`. */
const CODE = /^[A-Za-z0-9_.-]{1,100}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where the hook of `mapErrors` is told the call comes from. */
export interface MapErrorsInfo {
	/** The tool name of the operation that ran. */
	operation: string;
}

/** The hook of `mapErrors`: decides what the model reads of a call's errors. */
export type MapErrors = (
	errors: readonly GraphQLError[],
	info: MapErrorsInfo,
) => readonly ToolGraphqlError[] | undefined;

function build(
	code: string,
	path: unknown,
	fields: unknown,
	params: unknown,
): ToolGraphqlError {
	// The one cleaning rule of ai-core, so the model, the wire and the stores agree.
	return (
		cleanErrorDetails([{ code, path, fields, params }])[0] ?? {
			code: 'INTERNAL_ERROR',
		}
	);
}

/** Maps a GraphQL error to the part of it the model may see. */
export function toToolError(error: GraphQLError): ToolGraphqlError {
	const ext = error.extensions as Record<string, unknown> | undefined;
	const code =
		typeof ext?.['code'] === 'string' && CODE.test(ext['code'])
			? ext['code']
			: 'INTERNAL_ERROR';
	return build(code, error.path, ext?.['fields'], ext?.['params']);
}

/**
 * The errors the model reads: what `hook` returns, cut down to `code`, `path`,
 * `fields` and scalar `params`, or the default mapping when the hook is absent,
 * throws, returns a promise or returns anything but a non-empty list of
 * entries with a plain code. A hook can never widen what the model sees.
 */
export function mapToolErrors(
	errors: readonly GraphQLError[],
	hook: MapErrors | undefined,
	info: MapErrorsInfo,
): ToolGraphqlError[] {
	if (hook) {
		try {
			const raw: unknown = hook(errors, info);
			if (Array.isArray(raw) && raw.length > 0) {
				const kept: ToolGraphqlError[] = [];
				for (const e of raw.slice(0, 50)) {
					if (!isRecord(e) || typeof e['code'] !== 'string') break;
					if (!CODE.test(e['code'])) break;
					kept.push(build(e['code'], e['path'], e['fields'], e['params']));
				}
				if (kept.length === Math.min(raw.length, 50)) return kept;
			}
		} catch {
			// Never the hook's message: fall back to the default mapping.
		}
	}
	return errors.map(toToolError);
}

const NOTE_FULL =
	'Ask again with narrower variables (a filter, a smaller limit or page) or fewer fields.';

/**
 * The output as is when its JSON fits `max`, else a truncation marker whose
 * own JSON also fits `max` (the preview shrinks to make room, escaping
 * included; a tiny `max` drops the note, then the preview). Throws when the
 * output cannot be serialised.
 */
export function fitOutput(
	output: GraphqlToolOutput,
	max: number,
): GraphqlToolOutput | TruncatedGraphqlOutput {
	const json = JSON.stringify(output) ?? '';
	if (json.length <= max) return output;
	const marker = (preview: string, note: string): TruncatedGraphqlOutput => ({
		truncated: true,
		originalChars: json.length,
		preview,
		note,
	});
	const size = (m: TruncatedGraphqlOutput) => JSON.stringify(m).length;
	for (const note of [`Result cut. ${NOTE_FULL}`, 'Result cut.', '']) {
		if (size(marker('', note)) > max) continue;
		let lo = 0;
		let hi = Math.min(max, json.length);
		while (lo < hi) {
			const mid = Math.ceil((lo + hi) / 2);
			if (size(marker(json.slice(0, mid), note)) <= max) lo = mid;
			else hi = mid - 1;
		}
		return marker(json.slice(0, lo), note);
	}
	return marker('', '');
}

export const rootsAllNull = (data: unknown): boolean =>
	typeof data === 'object' &&
	data !== null &&
	Object.values(data).every((v) => v === null);

export function failure(errors: readonly ToolGraphqlError[]): AiError {
	return new AiError(
		'TOOL_FAILED',
		`The GraphQL operation failed: ${JSON.stringify(errors)}`,
		{ details: errors },
	);
}

const INTERNAL = [{ code: 'INTERNAL_ERROR' }] as const;

/** The failure for an error whose cause must not reach the model. */
export function internalFailure(cause: unknown): AiError {
	return new AiError(
		'TOOL_FAILED',
		`The GraphQL operation failed: ${JSON.stringify(INTERNAL)}`,
		{ cause, details: INTERNAL },
	);
}
