import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type AnyTool, executeTool } from '@nxgt/ai-core';
import { McpServerError } from './server-errors';
import { serveFetch } from './server-fetch';

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
	/**
	 * Aborts a tool that runs longer than this many milliseconds and answers
	 * `{"code":"TOOL_TIMEOUT"}`. Default: no limit. A tool that ignores its
	 * signal keeps running, but the client gets its answer at once.
	 */
	timeoutMs?: number;
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

interface ServedTools {
	byName: Map<string, AnyTool>;
	listed: {
		name: string;
		description: string;
		inputSchema: unknown;
		annotations?: { readOnlyHint: true };
	}[];
}

/** Validates the options and indexes the tools; throws `INVALID_OPTIONS`. */
function assertTools(options: McpServerOptions<unknown>): ServedTools {
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
	if (
		options.timeoutMs !== undefined &&
		!(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0)
	) {
		throw new McpServerError(
			'INVALID_OPTIONS',
			'timeoutMs must be a positive number of milliseconds.',
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
		...(tool.confirm ? {} : { annotations: { readOnlyHint: true as const } }),
	}));
	return { byName, listed };
}

const TIMED_OUT = Symbol('timed out');

/**
 * One MCP `Server` wired to the tools. `getContext` is memoised by the caller
 * for one HTTP request; `requestSignal` is the HTTP request's own signal, the
 * only one that fires when the client disconnects in stateless JSON mode.
 */
function buildServer(
	options: McpServerOptions<unknown>,
	{ byName, listed }: ServedTools,
	getContext: () => Promise<unknown>,
	requestSignal?: AbortSignal,
): Server {
	const server = new Server(
		{ name: options.name, version: options.version },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: listed }));
	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const tool = byName.get(request.params.name);
		if (!tool) return failure('UNKNOWN_TOOL');
		let context: unknown;
		try {
			context = await getContext();
		} catch {
			return failure('TOOL_FAILED');
		}
		const timeout =
			options.timeoutMs === undefined
				? undefined
				: AbortSignal.timeout(options.timeoutMs);
		const signal = AbortSignal.any(
			[extra.signal, requestSignal, timeout].filter(
				(s): s is AbortSignal => s !== undefined,
			),
		);
		try {
			const running = executeTool(
				tool,
				{
					type: 'tool-call',
					id: String(extra.requestId),
					name: tool.name,
					input: request.params.arguments ?? {},
				},
				{ context, signal },
			);
			const timedOut = timeout
				? new Promise<typeof TIMED_OUT>((resolve) =>
						timeout.addEventListener('abort', () => resolve(TIMED_OUT)),
					)
				: undefined;
			const result = await (timedOut
				? Promise.race([running, timedOut])
				: running);
			if (result === TIMED_OUT || timeout?.aborted) {
				running.catch(() => undefined);
				return failure('TOOL_TIMEOUT');
			}
			if (result.isError) return failure(result.error.code);
			const output = result.output;
			return {
				content: [{ type: 'text' as const, text: serialise(output) }],
				...(isPlainObject(output) ? { structuredContent: output } : {}),
			};
		} catch (error) {
			if (timeout?.aborted) return failure('TOOL_TIMEOUT');
			// Otherwise only an abort rejects `executeTool`; the client is gone
			// or cancelled, so the answer is never read.
			if (signal.aborted) throw error;
			return failure('TOOL_FAILED');
		}
	});
	return server;
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
	const served = assertTools(options);

	async function connect(transport: Transport) {
		const server = buildServer(options, served, async () =>
			options.context?.({}),
		);
		await server.connect(transport);
		return { close: () => server.close() };
	}

	return {
		connect,
		stdio: () => connect(new StdioServerTransport()),
		fetch: (request) =>
			serveFetch(request, (requestSignal) => {
				let memo: Promise<unknown> | undefined;
				return buildServer(
					options,
					served,
					() => {
						memo ??= Promise.resolve(options.context?.({ request }));
						return memo;
					},
					requestSignal,
				);
			}),
	};
}
