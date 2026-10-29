/** Every code of an error the SDK raises or reports; later slices add codes. */
export const AI_ERROR_CODES = [
	'INVALID_TOOL_DEFINITION',
	'INVALID_TOOL_INPUT',
	'INVALID_TOOL_OUTPUT',
	'TOOL_FAILED',
	'UNKNOWN_TOOL',
	'MODEL_ERROR',
	'RATE_LIMITED',
	'AUTHENTICATION',
	'ABORTED',
	'MAX_STEPS',
	'BUDGET_EXCEEDED',
	'ACTION_EXPIRED',
	'ACTION_NOT_PENDING',
	'INVALID_REQUEST',
] as const;

/**
 * The code of an error the SDK raises or reports. Adding one is not a breaking
 * change, so switch with a default branch.
 */
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * An error code as read from the wire: a known code, or any string a newer
 * server sent. Autocomplete keeps the known ones; keep a `default` branch.
 */
export type WireErrorCode = AiErrorCode | (string & {});

/** One problem found in a tool's input, located by a dotted path. */
export interface AiIssue {
	/** Dotted path into the input; `''` for the input itself. */
	path: string;
	message: string;
}

/**
 * One structured reason a tool failed, as a tool reports it (a GraphQL
 * operation's `extensions.code`, say). Bounded and free of messages, so an
 * application may store it and show it to its user.
 */
export interface ToolErrorDetail {
	/** The tool's own code: letters, digits, `_`, `.` and `-`, at most 100. */
	code: string;
	/** Where the failure sits, when the tool says (a response path). */
	path?: (string | number)[];
	/** The input fields at fault. */
	fields?: string[];
	/** Scalar values that explain the code (a limit, an id). */
	params?: Record<string, string | number | boolean>;
}

const DETAIL_CODE = /^[A-Za-z0-9_.-]{1,100}$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanDetail(raw: unknown): ToolErrorDetail | undefined {
	if (!isRecord(raw)) return undefined;
	const code = raw['code'];
	if (typeof code !== 'string' || !DETAIL_CODE.test(code)) return undefined;
	const out: ToolErrorDetail = { code };
	const { path, fields, params } = raw;
	if (
		Array.isArray(path) &&
		path.length > 0 &&
		path.every(
			(p) =>
				typeof p === 'number' || (typeof p === 'string' && p.length <= 200),
		)
	) {
		out.path = path.slice(0, 20);
	}
	if (Array.isArray(fields) && fields.every((f) => typeof f === 'string')) {
		out.fields = fields.slice(0, 20).map((f: string) => f.slice(0, 200));
	}
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
		if (Object.keys(kept).length > 0) out.params = kept;
	}
	return out;
}

/**
 * The details a store or a wire may keep: at most 50 entries, each with a
 * plain `code` (an entry without one is dropped), a short `path`, up to 20
 * `fields` and up to 20 scalar `params`. Anything else is cut, so a message
 * or an object can never ride along. Returns `[]` for anything but a list.
 */
export function cleanErrorDetails(raw: unknown): ToolErrorDetail[] {
	if (!Array.isArray(raw)) return [];
	const kept: ToolErrorDetail[] = [];
	for (const entry of raw.slice(0, 50)) {
		const detail = cleanDetail(entry);
		if (detail) kept.push(detail);
	}
	return kept;
}

export interface AiErrorOptions {
	cause?: unknown;
	issues?: readonly AiIssue[];
	/** The tool's own reasons; cleaned by `cleanErrorDetails`. */
	details?: readonly ToolErrorDetail[];
}

/** The one error this package raises of its own. */
export class AiError extends Error {
	override name = 'AiError';
	readonly code: AiErrorCode;
	readonly issues: readonly AiIssue[];
	/** The tool's own reasons, structured; empty when it gave none. */
	readonly details: readonly ToolErrorDetail[];

	constructor(
		code: AiErrorCode,
		message: string,
		options: AiErrorOptions = {},
	) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.code = code;
		this.issues = options.issues ?? [];
		this.details = cleanErrorDetails(options.details);
	}
}
