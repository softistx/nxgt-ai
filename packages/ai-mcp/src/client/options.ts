import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AnyTool } from '@nxgt/ai-core';
import { McpClientError } from './errors';
import { PACKAGE_VERSION } from './version';

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
	 * server lists. A name the server does not list throws `UNKNOWN_TOOL`.
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
	/** Name and version sent to the server; default `@nxgt/ai-mcp` and its version. */
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

// Temporary, until #76
export const DEFAULT_MAX_RESULT_CHARS = 20_000;

export interface ResolvedOptions {
	max: number;
	prefix: string;
	clientInfo: { name: string; version: string };
}

/** Checks the options that need no connection, and applies the defaults. */
export function resolveOptions(options: McpToolsOptions): ResolvedOptions {
	const max = options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
	if (!Number.isInteger(max) || max < 100) {
		throw new McpClientError(
			'INVALID_OPTIONS',
			'maxResultChars must be an integer of at least 100: a truncation marker needs room.',
		);
	}
	return {
		max,
		prefix: options.prefix ?? '',
		clientInfo: options.clientInfo ?? {
			name: '@nxgt/ai-mcp',
			version: PACKAGE_VERSION,
		},
	};
}
