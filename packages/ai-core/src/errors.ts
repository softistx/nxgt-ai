/**
 * The codes of every error the SDK raises or reports. Later slices add codes;
 * adding one is not a breaking change, so switch with a default branch.
 */
export type AiErrorCode =
	| 'INVALID_TOOL_DEFINITION'
	| 'INVALID_TOOL_INPUT'
	| 'INVALID_TOOL_OUTPUT'
	| 'TOOL_FAILED'
	| 'UNKNOWN_TOOL'
	| 'MODEL_ERROR'
	| 'RATE_LIMITED'
	| 'AUTHENTICATION'
	| 'ABORTED'
	| 'MAX_STEPS'
	| 'BUDGET_EXCEEDED'
	| 'ACTION_EXPIRED'
	| 'ACTION_NOT_PENDING';

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
