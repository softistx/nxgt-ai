/** Every code `mcpServer` throws while it is built; later slices may add codes. */
export const MCP_SERVER_ERROR_CODES = ['INVALID_OPTIONS'] as const;

/** Adding a code is not a breaking change, so switch with a default branch. */
export type McpServerErrorCode = (typeof MCP_SERVER_ERROR_CODES)[number];

/**
 * The error `mcpServer` throws when its options are wrong, never while a
 * client calls a tool: a failing call answers the client with a code only.
 */
export class McpServerError extends Error {
	override name = 'McpServerError';
	readonly code: McpServerErrorCode;
	/** The tool at fault, when the error is about one. */
	readonly tool: string | undefined;

	constructor(
		code: McpServerErrorCode,
		message: string,
		options: { tool?: string } = {},
	) {
		super(message);
		this.code = code;
		this.tool = options.tool;
	}
}
