import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
} from '@modelcontextprotocol/sdk/types.js';

export const SECRET = 'SECRET-internal-detail';

export interface Seen {
	calls: { name: string; args: unknown }[];
	aborted: boolean;
}

const obj = (
	properties: Record<string, unknown> = {},
	required: string[] = [],
) => ({
	type: 'object' as const,
	properties,
	required,
});

const TOOLS = [
	{
		name: 'echo',
		description: 'Repeats the text',
		inputSchema: obj({ text: { type: 'string' } }, ['text']),
		annotations: { readOnlyHint: true },
	},
	{
		name: 'add_note',
		description: 'Saves a note',
		inputSchema: obj({ text: { type: 'string' } }, ['text']),
	},
	{ name: 'fail', description: 'Reports an error', inputSchema: obj() },
	{ name: 'boom', description: 'Answers a protocol error', inputSchema: obj() },
	{ name: 'slow', description: 'Waits for an abort', inputSchema: obj() },
	{ name: 'big', description: 'A long text', inputSchema: obj() },
	{ name: 'image', description: 'An image', inputSchema: obj() },
	{ name: 'structured', description: 'Structured data', inputSchema: obj() },
	{
		name: 'bad.name',
		description: 'A name the model refuses',
		inputSchema: obj(),
	},
];

/** A low-level MCP server with a fixed set of tools; `seen` records what it got. */
export function createTestServer(seen: Seen = { calls: [], aborted: false }) {
	const server = new Server(
		{ name: 'test-server', version: '1.0.0' },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const { name, arguments: args } = request.params;
		seen.calls.push({ name, args });
		switch (name) {
			case 'echo':
				return { content: [{ type: 'text', text: `echo:${args?.['text']}` }] };
			case 'add_note':
				return { content: [{ type: 'text', text: 'saved' }] };
			case 'fail':
				return { isError: true, content: [{ type: 'text', text: SECRET }] };
			case 'boom':
				throw new McpError(ErrorCode.InternalError, SECRET);
			case 'slow':
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 5000);
					extra.signal.addEventListener('abort', () => {
						seen.aborted = true;
						clearTimeout(timer);
						resolve();
					});
				});
				return { content: [{ type: 'text', text: 'late' }] };
			case 'big':
				return { content: [{ type: 'text', text: 'x'.repeat(5000) }] };
			case 'image':
				return {
					content: [
						{ type: 'image', data: 'QUJD'.repeat(100), mimeType: 'image/png' },
						{ type: 'text', text: 'caption' },
					],
				};
			case 'structured':
				return {
					content: [{ type: 'text', text: '{"n":1}' }],
					structuredContent: { n: 1 },
				};
			default:
				throw new McpError(ErrorCode.InvalidParams, `Unknown tool ${name}`);
		}
	});
	return server;
}
