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
] as const;

/**
 * The code of an error the SDK raises or reports. Adding one is not a breaking
 * change, so switch with a default branch.
 */
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** One problem found in a tool's input, located by a dotted path. */
export interface AiIssue {
	/** Dotted path into the input; `''` for the input itself. */
	path: string;
	message: string;
}

export interface AiErrorOptions {
	cause?: unknown;
	issues?: readonly AiIssue[];
}

/** The one error this package raises of its own. */
export class AiError extends Error {
	override name = 'AiError';
	readonly code: AiErrorCode;
	readonly issues: readonly AiIssue[];

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
	}
}
