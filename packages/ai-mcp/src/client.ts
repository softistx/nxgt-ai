import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
	AiError,
	type AnyTool,
	type JsonSchema,
	jsonSchemaTool,
	type ToolContext,
} from '@nxgt/ai-core';
import { McpClientError } from './errors';
import {
	fitOutput,
	type McpToolOutput,
	NOTICE,
	toContent,
	toolFailure,
} from './result';

export type { McpClientErrorCode, McpClientErrorOptions } from './errors';
export { MCP_CLIENT_ERROR_CODES, McpClientError } from './errors';
export type {
	McpContent,
	McpToolFailureCode,
	McpToolOutput,
	TruncatedMcpOutput,
} from './result';

/** Spawns a local MCP server and talks to it over its stdin and stdout. */
export interface McpStdioTransport {
	type: 'stdio';
	command: string;
	args?: readonly string[];
	/** Added to the safe default environment the SDK passes to the child. */
	env?: Readonly<Record<string, string>>;
	cwd?: string;
}

/** Talks to a remote MCP server over Streamable HTTP. */
export interface McpHttpTransport {
	type: 'http';
	url: string | URL;
	/** Sent on every request, e.g. `Authorization`. */
	headers?: Readonly<Record<string, string>>;
}

/** An SDK `Transport` you built yourself (in-memory, a custom channel). */
export interface McpCustomTransport {
	type: 'transport';
	transport: Transport;
}

export interface McpToolsOptions {
	transport: McpStdioTransport | McpHttpTransport | McpCustomTransport;
	/**
	 * The allow-list, by the server's own tool names. Default: every tool the
	 * server lists. A name the server does not list throws `TOOL_NOT_FOUND`.
	 */
	include?: readonly string[];
	/** Put before each tool name for the model (`docs_` + `search`). */
	prefix?: string;
	/**
	 * Per tool, by the server's name: `true` to require a confirmation, `false`
	 * to run directly. Default: confirm unless the tool's `readOnlyHint` is true.
	 */
	confirm?: Readonly<Record<string, boolean>>;
	/** Longest serialised result handed to the model; default 20000. */
	maxResultChars?: number;
	/** Name and version sent to the server; default `@nxgt/ai-mcp`. */
	clientInfo?: { name: string; version: string };
	/** Aborts connecting and listing. */
	signal?: AbortSignal;
}

export interface McpToolsHandle {
	/** Tools for `runAgent`. */
	tools: AnyTool[];
	/** Closes the connection (and stops a stdio child). Safe to call twice. */
	close(): Promise<void>;
}

export const DEFAULT_MAX_RESULT_CHARS = 20_000;

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function createTransport(t: McpToolsOptions['transport']): Transport {
	switch (t.type) {
		case 'stdio':
			return new StdioClientTransport({
				command: t.command,
				...(t.args ? { args: [...t.args] } : {}),
				...(t.env ? { env: { ...t.env } } : {}),
				...(t.cwd ? { cwd: t.cwd } : {}),
			});
		case 'http':
			return new StreamableHTTPClientTransport(
				typeof t.url === 'string' ? new URL(t.url) : t.url,
				t.headers ? { requestInit: { headers: { ...t.headers } } } : {},
			);
		case 'transport':
			return t.transport;
		default:
			throw new McpClientError(
				'INVALID_OPTIONS',
				'transport.type must be "stdio", "http" or "transport".',
			);
	}
}

interface ListedTool {
	name: string;
	description?: string | undefined;
	inputSchema: unknown;
	annotations?: { readOnlyHint?: boolean | undefined } | undefined;
}

async function listAll(
	client: Client,
	signal: AbortSignal | undefined,
): Promise<ListedTool[]> {
	const all: ListedTool[] = [];
	let cursor: string | undefined;
	do {
		const page = await client.listTools(
			cursor === undefined ? {} : { cursor },
			signal ? { signal } : undefined,
		);
		all.push(...(page.tools as ListedTool[]));
		cursor = page.nextCursor;
	} while (cursor);
	return all;
}

/**
 * Connects to an MCP server and returns its tools as `@nxgt/ai-core` tools,
 * plus `close()`. Connecting and listing failures throw `McpClientError`; a
 * call that fails while an agent runs answers the model with a code only
 * (`MCP_TOOL_FAILED`, `MCP_UNAVAILABLE`), never the server's text. A tool is
 * `confirm: true` unless the server marks it `readOnlyHint`.
 */
export async function mcpTools(
	options: McpToolsOptions,
): Promise<McpToolsHandle> {
	const max = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
	if (!Number.isInteger(max) || max < 100) {
		throw new McpClientError(
			'INVALID_OPTIONS',
			'maxResultChars must be an integer of at least 100: a truncation marker needs room.',
		);
	}
	const prefix = options.prefix ?? '';
	const client = new Client(
		options.clientInfo ?? { name: '@nxgt/ai-mcp', version: '0.0.0' },
	);
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

	let listed: ListedTool[];
	try {
		await client.connect(
			createTransport(options.transport),
			options.signal ? { signal: options.signal } : undefined,
		);
	} catch (cause) {
		await close();
		if (cause instanceof McpClientError) throw cause;
		throw new McpClientError(
			'MCP_UNAVAILABLE',
			'Could not connect to the MCP server.',
			{ cause },
		);
	}
	try {
		listed = await listAll(client, options.signal);
	} catch (cause) {
		await close();
		throw new McpClientError(
			'MCP_LIST_FAILED',
			'The MCP server did not list its tools.',
			{ cause },
		);
	}

	try {
		const byName = new Map(listed.map((t) => [t.name, t]));
		let chosen = listed;
		if (options.include) {
			chosen = options.include.map((name) => {
				const found = byName.get(name);
				if (!found) {
					throw new McpClientError(
						'TOOL_NOT_FOUND',
						`The MCP server lists no tool named "${name.slice(0, 100)}".`,
						{ tool: name },
					);
				}
				return found;
			});
		}
		const seen = new Set<string>();
		const tools = chosen.map((t) => {
			const name = `${prefix}${t.name}`;
			if (!NAME.test(name)) {
				throw new McpClientError(
					'INVALID_TOOL',
					`The tool name "${name.slice(0, 100)}" is not 1 to 64 letters, digits, "_" or "-": allow-list the tools you want with "include", or change "prefix".`,
					{ tool: t.name },
				);
			}
			if (seen.has(name)) {
				throw new McpClientError(
					'DUPLICATE_TOOL',
					`Two tools are named "${name}".`,
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

function buildTool(
	client: Client,
	t: ListedTool,
	name: string,
	options: McpToolsOptions,
	max: number,
	isClosed: () => boolean,
): AnyTool {
	const confirm =
		options.confirm?.[t.name] ?? t.annotations?.readOnlyHint !== true;
	let tool: AnyTool;
	try {
		tool = jsonSchemaTool({
			name,
			description: t.description?.trim() || `MCP tool ${t.name}`,
			inputSchema: t.inputSchema as JsonSchema,
			confirm,
			async execute(input, ctx: ToolContext) {
				ctx.signal.throwIfAborted();
				if (isClosed()) throw toolFailure('MCP_UNAVAILABLE');
				let result: Awaited<ReturnType<Client['callTool']>>;
				try {
					result = await client.callTool(
						{
							name: t.name,
							arguments: (input ?? {}) as Record<string, unknown>,
						},
						undefined,
						{ signal: ctx.signal },
					);
				} catch (cause) {
					ctx.signal.throwIfAborted();
					// A server error answer is the tool failing; anything else
					// (closed pipe, timeout, HTTP failure) is the server being out.
					throw toolFailure(
						cause instanceof McpError ? 'MCP_TOOL_FAILED' : 'MCP_UNAVAILABLE',
						cause,
					);
				}
				if (result['isError']) throw toolFailure('MCP_TOOL_FAILED');
				const output: McpToolOutput = {
					source: 'mcp',
					notice: NOTICE,
					content: toContent(result['content']),
					...(result['structuredContent'] === undefined
						? {}
						: { structuredContent: result['structuredContent'] }),
				};
				try {
					return fitOutput(output, max);
				} catch (cause) {
					throw toolFailure('MCP_TOOL_FAILED', cause);
				}
			},
		});
	} catch (cause) {
		if (cause instanceof AiError) {
			throw new McpClientError(
				'INVALID_TOOL',
				`The tool "${name.slice(0, 100)}" has no usable object input schema.`,
				{ tool: t.name, cause },
			);
		}
		throw cause;
	}
	return tool;
}
