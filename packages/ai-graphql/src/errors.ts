/** Every code `graphqlTools` raises at build time; later slices may add codes. */
export const GRAPHQL_TOOLS_ERROR_CODES = [
	'FORBIDDEN_FIELD',
	'INVALID_OPERATION',
	'DUPLICATE_OPERATION',
] as const;

/** Adding a code is not a breaking change, so switch with a default branch. */
export type GraphqlToolsErrorCode = (typeof GRAPHQL_TOOLS_ERROR_CODES)[number];

export interface GraphqlToolsErrorOptions {
	/** The tool name of the operation at fault. */
	operation: string;
	/** `Type.field` of the forbidden field, for `FORBIDDEN_FIELD`. */
	field?: string;
	/** Response path of the field in the operation, for `FORBIDDEN_FIELD`. */
	path?: string;
	cause?: unknown;
}

/** The error `graphqlTools` throws while building, never while a tool runs. */
export class GraphqlToolsError extends Error {
	override name = 'GraphqlToolsError';
	readonly code: GraphqlToolsErrorCode;
	readonly operation: string;
	readonly field: string | undefined;
	readonly path: string | undefined;

	constructor(
		code: GraphqlToolsErrorCode,
		message: string,
		options: GraphqlToolsErrorOptions,
	) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.code = code;
		this.operation = options.operation;
		this.field = options.field;
		this.path = options.path;
	}
}
