import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpClientError } from './errors';
import { connectAndList, selectTools } from './list';
import {
	type McpToolsHandle,
	type McpToolsOptions,
	resolveOptions,
} from './options';
import { buildTool } from './tool';

export type { McpClientErrorCode, McpClientErrorOptions } from './errors';
export { MCP_CLIENT_ERROR_CODES, McpClientError } from './errors';
export type {
	McpCustomTransport,
	McpHttpTransport,
	McpStdioTransport,
	McpToolsHandle,
	McpToolsOptions,
} from './options';
export { DEFAULT_MAX_RESULT_CHARS } from './options';
export type {
	McpContent,
	McpToolFailureCode,
	McpToolOutput,
	TruncatedMcpOutput,
} from './result';

/**
 * Connects to an MCP server and returns its tools as `@nxgt/ai-core` tools,
 * plus `close()`. Connecting and listing failures throw `McpClientError`; a
 * call that fails while an agent runs answers the model with a code only
 * (`MCP_TOOL_FAILED`, `MCP_UNAVAILABLE`), plus the server's own code when it
 * sent a bare one, never the server's text. A tool is `confirm: true` unless
 * the server marks it `readOnlyHint`.
 */
export async function mcpTools(
	options: McpToolsOptions,
): Promise<McpToolsHandle> {
	const { max, prefix, clientInfo } = resolveOptions(options);
	const client = new Client(clientInfo);
	let closed = false;
	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		try {
			await client.close();
		} catch {
			// Closing a broken connection has nothing left to report.
		}
	};

	try {
		const listed = await connectAndList(client, options);
		const seen = new Set<string>();
		const tools = selectTools(listed, options.include).map((t) => {
			const name = `${prefix}${t.name}`;
			if (seen.has(name)) {
				throw new McpClientError(
					'DUPLICATE_TOOL',
					`Two tools are named "${name.slice(0, 100)}".`,
					{ tool: t.name },
				);
			}
			seen.add(name);
			return buildTool(client, t, name, options, max, () => closed);
		});
		return { tools, close };
	} catch (error) {
		await close();
		throw error;
	}
}
