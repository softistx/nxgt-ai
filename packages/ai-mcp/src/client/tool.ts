import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
	AiError,
	type AnyTool,
	type JsonSchema,
	jsonSchemaTool,
	type ToolContext,
} from '@nxgt/ai-core';
import { McpClientError } from './errors';
import type { ListedTool } from './list';
import type { McpToolsOptions } from './options';
import {
	fitOutput,
	type McpContent,
	type McpToolOutput,
	NOTICE,
	serverCodeOf,
	toContent,
	toolFailure,
} from './result';

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_DESCRIPTION_CHARS = 2048;
const MAX_SCHEMA_CHARS = 32 * 1024;

/** A protocol error the server answered, not a closed pipe or a timeout. */
const isServerAnswer = (cause: unknown): boolean =>
	cause instanceof McpError &&
	cause.code !== ErrorCode.ConnectionClosed &&
	cause.code !== ErrorCode.RequestTimeout;

const invalid = (name: string, tool: string, why: string, cause?: unknown) =>
	new McpClientError(
		'INVALID_TOOL_DEFINITION',
		`The tool "${name.slice(0, 100)}" ${why}`,
		cause === undefined ? { tool } : { tool, cause },
	);

/** Drops the text blocks that only repeat `structuredContent`. */
function withoutDuplicate(
	content: McpContent[],
	structured: unknown,
): McpContent[] {
	if (structured === undefined) return content;
	const json = JSON.stringify(structured);
	return content.filter((c) => !(c.type === 'text' && c.text === json));
}

/** Builds the `@nxgt/ai-core` tool for one listed tool, or throws `McpClientError`. */
export function buildTool(
	client: Client,
	t: ListedTool,
	name: string,
	options: McpToolsOptions,
	max: number,
	isClosed: () => boolean,
): AnyTool {
	if (!NAME.test(name)) {
		throw invalid(
			name,
			t.name,
			'is not named with 1 to 64 letters, digits, "_" or "-": allow-list the tools you want with "include", or change "prefix".',
		);
	}
	const description = t.description?.trim() || `MCP tool ${t.name}`;
	if (description.length > MAX_DESCRIPTION_CHARS) {
		throw invalid(
			name,
			t.name,
			`has a description over ${MAX_DESCRIPTION_CHARS} characters: allow-list the tools you trust with "include".`,
		);
	}
	if ((JSON.stringify(t.inputSchema) ?? '').length > MAX_SCHEMA_CHARS) {
		throw invalid(
			name,
			t.name,
			`has an input schema over ${MAX_SCHEMA_CHARS} characters: allow-list the tools you trust with "include".`,
		);
	}
	const confirm =
		options.confirm && Object.hasOwn(options.confirm, t.name)
			? options.confirm[t.name]
			: t.annotations?.readOnlyHint !== true;
	try {
		return jsonSchemaTool({
			name,
			description,
			inputSchema: t.inputSchema as JsonSchema,
			confirm: confirm !== false,
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
						isServerAnswer(cause) ? 'MCP_TOOL_FAILED' : 'MCP_UNAVAILABLE',
						cause,
					);
				}
				if (result['isError']) {
					throw toolFailure(
						'MCP_TOOL_FAILED',
						undefined,
						serverCodeOf(result['content']),
					);
				}
				const structured = result['structuredContent'];
				const output: McpToolOutput = {
					source: 'mcp',
					notice: NOTICE,
					content: withoutDuplicate(toContent(result['content']), structured),
					...(structured === undefined
						? {}
						: { structuredContent: structured }),
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
			throw invalid(name, t.name, 'has no usable object input schema.', cause);
		}
		throw cause;
	}
}
