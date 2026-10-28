import { afterEach, describe, expect, it } from 'bun:test';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { defineTool, executeTool } from '@nxgt/ai-core';
import { z } from 'zod';
import pkg from '../../package.json';
import { mcpServer } from '../server';
import { McpClientError, type McpToolsOptions, mcpTools } from './index';
import { MAX_PAGES } from './list';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map((c) => c()));
});

type Listed = {
	name: string;
	description?: string;
	inputSchema: unknown;
};
const objectSchema = { type: 'object', properties: {} };

/** A server whose `tools/list` and `tools/call` are the given functions. */
async function connect(
	list: (cursor: string | undefined) => {
		tools: Listed[];
		nextCursor?: string;
	},
	options: Omit<McpToolsOptions, 'transport'> = {},
	call: (name: string) => Record<string, unknown> = () => ({ content: [] }),
) {
	const [client, serverSide] = InMemoryTransport.createLinkedPair();
	const server = new Server(
		{ name: 'fake', version: '1.0.0' },
		{ capabilities: { tools: {} } },
	);
	server.setRequestHandler(ListToolsRequestSchema, (req) =>
		list(req.params?.cursor),
	);
	server.setRequestHandler(CallToolRequestSchema, (req) =>
		call(req.params.name),
	);
	await server.connect(serverSide);
	const handle = await mcpTools({
		...options,
		transport: { type: 'transport', transport: client },
	});
	closers.push(handle.close);
	return handle;
}

const expectCode = async (p: Promise<unknown>, code: string) => {
	const error = await p.then(
		() => undefined,
		(e) => e,
	);
	expect(error).toBeInstanceOf(McpClientError);
	expect(error).toMatchObject({ code });
	return error as McpClientError;
};

const tool = (name: string, extra: Partial<Listed> = {}): Listed => ({
	name,
	description: 'd',
	inputSchema: objectSchema,
	...extra,
});

describe('mcpTools: pagination', () => {
	it('follows nextCursor across pages', async () => {
		const { tools } = await connect((cursor) =>
			cursor === undefined
				? { tools: [tool('a')], nextCursor: 'p2' }
				: { tools: [tool('b')] },
		);
		expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
	});

	it('stops on a repeated cursor with MCP_LIST_FAILED', async () => {
		let requests = 0;
		const error = await expectCode(
			connect(() => {
				// The server-side cap keeps a regression from hanging the run.
				if (++requests > 50) return { tools: [] };
				return { tools: [tool(`t${requests}`)], nextCursor: 'same' };
			}),
			'MCP_LIST_FAILED',
		);
		expect(String(error.cause)).toContain('twice');
		expect(requests).toBeLessThan(10);
	});

	it('stops after the page cap when every cursor is new', async () => {
		let requests = 0;
		const error = await expectCode(
			connect(() => {
				if (++requests > MAX_PAGES + 20) return { tools: [] };
				return { tools: [], nextCursor: `c${requests}` };
			}),
			'MCP_LIST_FAILED',
		);
		expect(String(error.cause)).toContain('pages');
		expect(requests).toBe(MAX_PAGES);
	});

	it('stops after 1000 tools', async () => {
		let requests = 0;
		const error = await expectCode(
			connect(() => {
				if (++requests > 20) return { tools: [] };
				return {
					tools: Array.from({ length: 400 }, (_, i) =>
						tool(`t${requests}_${i}`),
					),
					nextCursor: `c${requests}`,
				};
			}),
			'MCP_LIST_FAILED',
		);
		expect(String(error.cause)).toContain('tools');
		expect(requests).toBe(3);
	});
});

describe('mcpTools: setup errors', () => {
	it('throws MCP_LIST_FAILED when the server has no tools capability', async () => {
		const [client, serverSide] = InMemoryTransport.createLinkedPair();
		const server = new Server(
			{ name: 'bare', version: '1.0.0' },
			{ capabilities: {} },
		);
		await server.connect(serverSide);
		const error = await expectCode(
			mcpTools({ transport: { type: 'transport', transport: client } }),
			'MCP_LIST_FAILED',
		);
		expect(error.cause).toBeDefined();
		await server.close();
	});

	it('throws DUPLICATE_TOOL when the server lists a name twice', async () => {
		const error = await expectCode(
			connect(() => ({ tools: [tool('a'), tool('a')] })),
			'DUPLICATE_TOOL',
		);
		expect(error.tool).toBe('a');
	});

	it('throws DUPLICATE_TOOL when a name repeats only once prefixed', async () => {
		await expectCode(
			connect(() => ({ tools: [tool('a'), tool('a')] }), { prefix: 'x_' }),
			'DUPLICATE_TOOL',
		);
	});

	it('refuses a non-object input schema: the SDK rejects the listing', async () => {
		const error = await expectCode(
			connect(() => ({
				tools: [tool('a', { inputSchema: { type: 'string' } })],
			})),
			'MCP_LIST_FAILED',
		);
		expect(error.cause).toBeDefined();
	});

	it('refuses a description over 2048 characters, unless include skips the tool', async () => {
		const list = () => ({
			tools: [tool('big', { description: 'x'.repeat(2049) }), tool('ok')],
		});
		await expectCode(connect(list), 'INVALID_TOOL_DEFINITION');
		const { tools } = await connect(list, { include: ['ok'] });
		expect(tools.map((t) => t.name)).toEqual(['ok']);
	});

	it('accepts a description of exactly 2048 characters', async () => {
		const { tools } = await connect(() => ({
			tools: [tool('a', { description: 'x'.repeat(2048) })],
		}));
		expect(tools).toHaveLength(1);
	});

	it('refuses an input schema over 32 KiB', async () => {
		const schema = {
			type: 'object',
			properties: { p: { type: 'string', description: 'y'.repeat(33_000) } },
		};
		await expectCode(
			connect(() => ({ tools: [tool('a', { inputSchema: schema })] })),
			'INVALID_TOOL_DEFINITION',
		);
	});

	it('throws INVALID_OPTIONS for an unknown transport type', async () => {
		await expectCode(
			mcpTools({ transport: { type: 'carrier-pigeon' } as never }),
			'INVALID_OPTIONS',
		);
	});

	it('rejects when aborted during connect, and closes', async () => {
		const [client] = InMemoryTransport.createLinkedPair();
		// No server answers `initialize`: connecting waits until the abort.
		const controller = new AbortController();
		const pending = mcpTools({
			transport: { type: 'transport', transport: client },
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(new Error('stop')), 20);
		await expectCode(pending, 'MCP_UNAVAILABLE');
	});
});

describe('mcpTools: confirm overrides', () => {
	it('ignores inherited keys: a tool named constructor keeps its default', async () => {
		const { tools } = await connect(
			() => ({
				tools: [tool('constructor'), tool('toString', {})],
			}),
			{ confirm: {} },
		);
		expect(tools.map((t) => [t.name, t.confirm])).toEqual([
			['constructor', true],
			['toString', true],
		]);
	});

	it('still honours an own key', async () => {
		const { tools } = await connect(() => ({ tools: [tool('a')] }), {
			confirm: { a: false },
		});
		expect(tools[0]?.confirm).toBe(false);
	});
});

describe('mcpTools: results', () => {
	it('drops a text block that repeats structuredContent', async () => {
		const { tools } = await connect(
			() => ({ tools: [tool('s', { description: 'd' })] }),
			{},
			() => ({
				content: [
					{ type: 'text', text: '{"n":1}' },
					{ type: 'text', text: 'a note' },
				],
				structuredContent: { n: 1 },
			}),
		);
		const out = await executeTool(
			tools[0] as never,
			{ type: 'tool-call', id: '1', name: 's', input: {} },
			{},
		);
		expect(out).toMatchObject({
			output: {
				content: [{ type: 'text', text: 'a note' }],
				structuredContent: { n: 1 },
			},
		});
	});

	it('keeps the text when there is no structuredContent', async () => {
		const { tools } = await connect(
			() => ({ tools: [tool('s')] }),
			{},
			() => ({ content: [{ type: 'text', text: '{"n":1}' }] }),
		);
		const out = await executeTool(
			tools[0] as never,
			{ type: 'tool-call', id: '1', name: 's', input: {} },
			{},
		);
		expect(out).toMatchObject({
			output: { content: [{ type: 'text', text: '{"n":1}' }] },
		});
	});

	it('carries a bare server code, and only that, to the model', async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const served = await mcpServer({
			name: 'ai-mcp-server',
			version: '1.0.0',
			tools: [
				defineTool({
					name: 'echo',
					description: 'Repeats',
					input: z.object({ text: z.string() }),
					execute: ({ text }) => text,
				}),
			],
		}).connect(serverSide);
		const { tools, close } = await mcpTools({
			transport: { type: 'transport', transport: clientSide },
		});
		closers.push(close, () => served.close());
		const out = await executeTool(
			tools[0] as never,
			{ type: 'tool-call', id: '1', name: 'echo', input: { text: 5 } },
			{},
		);
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
		expect(JSON.stringify(out)).toContain(
			'{\\"code\\":\\"MCP_TOOL_FAILED\\",\\"serverCode\\":\\"INVALID_TOOL_INPUT\\"}',
		);
	});
});

describe('mcpTools: clientInfo', () => {
	it('sends the package version by default', async () => {
		const [client, serverSide] = InMemoryTransport.createLinkedPair();
		const server = new Server(
			{ name: 'fake', version: '1.0.0' },
			{ capabilities: { tools: {} } },
		);
		server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
		await server.connect(serverSide);
		const handle = await mcpTools({
			transport: { type: 'transport', transport: client },
		});
		closers.push(handle.close);
		expect(server.getClientVersion()).toEqual({
			name: '@nxgt/ai-mcp',
			version: pkg.version,
		});
	});
});
