/** Every code `mcpTools` throws while connecting; later slices may add codes. */
export const MCP_CLIENT_ERROR_CODES = [
	'INVALID_OPTIONS',
	'MCP_UNAVAILABLE',
	'MCP_LIST_FAILED',
	'UNKNOWN_TOOL',
	'INVALID_TOOL_DEFINITION',
	'DUPLICATE_TOOL',
] as const;

/** Adding a code is not a breaking change, so switch with a default branch. */
export type McpClientErrorCode = (typeof MCP_CLIENT_ERROR_CODES)[number];

export interface McpClientErrorOptions {
	/** The server tool at fault, for `UNKNOWN_TOOL`, `INVALID_TOOL_DEFINITION`, `DUPLICATE_TOOL`. */
	tool?: string;
	/** The underlying error. Read it in your logs; never show it to the model. */
	cause?: unknown;
}

/**
 * The error `mcpTools` throws while connecting and listing, never while a tool
 * runs. The message is written here, not taken from the server; the server's
 * own error is in `cause`.
 */
export class McpClientError extends Error {
	override name = 'McpClientError';
	readonly code: McpClientErrorCode;
	readonly tool: string | undefined;

	constructor(
		code: McpClientErrorCode,
		message: string,
		options: McpClientErrorOptions = {},
	) {
		super(
			message,
			options.cause === undefined ? undefined : { cause: options.cause },
		);
		this.code = code;
		this.tool = options.tool;
	}
}
