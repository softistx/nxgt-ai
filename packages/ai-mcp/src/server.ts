import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type AnyTool, executeTool } from '@nxgt/ai-core';
import { McpServerError } from './server-errors';

export type { McpServerErrorCode } from './server-errors';
export { MCP_SERVER_ERROR_CODES, McpServerError } from './server-errors';

/** What `context` receives: the request over `fetch`, nothing over stdio. */
export interface McpContextInfo {
	request?: Request;
}

export interface McpServerOptions<TContext = unknown> {
	/** The tools to serve, as `defineTool` or `jsonSchemaTool` built them. */
	tools: readonly AnyTool[];
	/**
	 * Builds the tool context (`ToolContext.context`) for a request, e.g. the
	 * viewer from the `Authorization` header. Called once per HTTP request, at
	 * the first tool call of that request, and once per `tools/call` over
	 * stdio. A throw answers the call with `TOOL_FAILED`.
	 */
	context?: (info: McpContextInfo) => TContext | PromiseLike<TContext>;
	/** Sent to clients in the handshake. */
	name: string;
	version: string;
	/**
	 * Serve `confirm: true` tools too. Default `false`: `mcpServer` throws
	 * `INVALID_OPTIONS` for one. MCP has no confirmation step, so a client
	 * would run the mutation without a human saying yes.
	 */
	allowConfirmTools?: boolean;
}

export interface McpServerHandle {
	/** Serves one MCP client on stdin and stdout until `close()` or the pipe ends. */
	stdio(): Promise<{ close(): Promise<void> }>;
	/** Serves one client over an SDK `Transport` you built (in memory, tests). */
	connect(transport: Transport): Promise<{ close(): Promise<void> }>;
	/** Streamable HTTP, stateless, answered as JSON. Mount it on one route. */
	fetch(request: Request): Promise<Response>;
}

const failure = (code: string) => ({
	isError: true as const,
	content: [{ type: 'text' as const, text: JSON.stringify({ code }) }],
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' &&
	v !== null &&
	!Array.isArray(v) &&
	Object.getPrototypeOf(v) === Object.prototype;

function serialise(output: unknown): string {
	if (typeof output === 'string') return output;
	return JSON.stringify(output) ?? '';
}

/**
 * Serves `@nxgt/ai-core` tools over MCP. The tool's schema validates the
 * input; a failure of any kind answers `isError` with `{"code":"…"}` and
 * nothing else: no message, stack or cause leaves the process. Tools with
 * `confirm: true` are refused (`INVALID_OPTIONS`) unless `allowConfirmTools`.
 */
export function mcpServer<TContext = unknown>(
	options: McpServerOptions<TContext>,
): McpServerHandle {
	if (
		typeof options.name !== 'string' ||
		options.name === '' ||
		typeof options.version !== 'string' ||
		options.version === ''
	) {
		throw new McpServerError(
			'INVALID_OPTIONS',
			'name and version are required: clients read them in the handshake.',
		);
	}
	const byName = new Map<string, AnyTool>();
	for (const tool of options.tools) {
		if (byName.has(tool.name)) {
			throw new McpServerError(
				'INVALID_OPTIONS',
				`Two tools are named "${tool.name}".`,
				{ tool: tool.name },
			);
		}
		if (tool.confirm && !options.allowConfirmTools) {
			throw new McpServerError(
				'INVALID_OPTIONS',
				`The tool "${tool.name}" is confirm: true and MCP has no confirmation step. Leave it out, or pass allowConfirmTools: true.`,
				{ tool: tool.name },
			);
		}
		byName.set(tool.name, tool);
	}
	const listed = [...byName.values()].map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
		...(tool.confirm ? {} : { annotations: { readOnlyHint: true } }),
	}));

	/** `getContext` is memoised by the caller for one HTTP request. */
	function build(getContext: () => Promise<unknown>): Server {
		const server = new Server(
			{ name: options.name, version: options.version },
			{ capabilities: { tools: {} } },
		);
		server.setRequestHandler(ListToolsRequestSchema, () => ({
			tools: listed,
		}));
		server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
			const tool = byName.get(request.params.name);
			if (!tool) return failure('UNKNOWN_TOOL');
			let context: unknown;
			try {
				context = await getContext();
			} catch {
				return failure('TOOL_FAILED');
			}
			try {
				const result = await executeTool(
					tool,
					{
						type: 'tool-call',
						id: String(extra.requestId),
						name: tool.name,
						input: request.params.arguments ?? {},
					},
					{ context, signal: extra.signal },
				);
				if (result.isError) return failure(result.error.code);
				const output = result.output;
				return {
					content: [{ type: 'text' as const, text: serialise(output) }],
					...(isPlainObject(output) ? { structuredContent: output } : {}),
				};
			} catch (error) {
				// Only an abort rejects `executeTool`; the client is gone or
				// cancelled, so the answer is never read.
				if (extra.signal.aborted) throw error;
				return failure('TOOL_FAILED');
			}
		});
		return server;
	}

	return {
		async connect(transport) {
			const server = build(async () => options.context?.({}));
			await server.connect(transport);
			return { close: () => server.close() };
		},
		stdio() {
			return this.connect(new StdioServerTransport());
		},
		async fetch(request) {
			let memo: Promise<unknown> | undefined;
			const server = build(() => {
				memo ??= Promise.resolve(options.context?.({ request }));
				return memo;
			});
			const transport = new WebStandardStreamableHTTPServerTransport({
				enableJsonResponse: true,
			});
			await server.connect(transport);
			return transport.handleRequest(request);
		},
	};
}
