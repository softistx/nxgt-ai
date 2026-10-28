import { afterEach, describe, expect, it } from 'bun:test';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type AnyTool, executeTool } from '@nxgt/ai-core';
import { createTestServer, SECRET, type Seen } from '../../test/server';
import { McpClientError, type McpToolsOptions, mcpTools } from './index';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map((c) => c()));
});

async function connect(
	options: Omit<McpToolsOptions, 'transport'> = {},
	seen: Seen = { calls: [], aborted: false },
) {
	const [client, serverSide] = InMemoryTransport.createLinkedPair();
	await createTestServer(seen).connect(serverSide);
	const handle = await mcpTools({
		...options,
		transport: { type: 'transport', transport: client },
	});
	closers.push(handle.close);
	return { ...handle, seen };
}

const find = (tools: AnyTool[], name: string): AnyTool => {
	const tool = tools.find((t) => t.name === name);
	if (!tool) throw new Error(`no tool ${name}`);
	return tool;
};
const call = (name: string, input: unknown = {}) => ({
	type: 'tool-call' as const,
	id: 'c1',
	name,
	input,
});
const run = (
	tools: AnyTool[],
	name: string,
	input?: unknown,
	signal?: AbortSignal,
) =>
	executeTool(find(tools, name), call(name, input), signal ? { signal } : {});

describe('mcpTools: listing', () => {
	it('lists the server tools as ai-core tools', async () => {
		const { tools } = await connect({ include: ['echo', 'add_note'] });
		expect(tools.map((t) => t.name)).toEqual(['echo', 'add_note']);
		expect(find(tools, 'echo').description).toBe('Repeats the text');
		expect(find(tools, 'echo').inputSchema).toMatchObject({
			type: 'object',
			properties: { text: { type: 'string' } },
		});
	});

	it('refuses a tool name the model cannot use, naming the include option', async () => {
		const error = await connect().catch((e) => e);
		expect(error).toBeInstanceOf(McpClientError);
		expect(error).toMatchObject({
			code: 'INVALID_TOOL_DEFINITION',
			tool: 'bad.name',
		});
	});

	it('keeps only the allow-listed tools', async () => {
		const { tools } = await connect({ include: ['echo'] });
		expect(tools.map((t) => t.name)).toEqual(['echo']);
	});

	it('throws UNKNOWN_TOOL for an allow-listed name the server lacks', async () => {
		const error = await connect({ include: ['echo', 'nope'] }).catch((e) => e);
		expect(error).toMatchObject({ code: 'UNKNOWN_TOOL', tool: 'nope' });
	});

	it('prefixes the model name but calls the server name', async () => {
		const { tools, seen } = await connect({
			include: ['echo'],
			prefix: 'docs_',
		});
		expect(tools.map((t) => t.name)).toEqual(['docs_echo']);
		await run(tools, 'docs_echo', { text: 'a' });
		expect(seen.calls[0]?.name).toBe('echo');
	});

	it('rejects a too small maxResultChars before connecting', async () => {
		const error = await mcpTools({
			transport: { type: 'stdio', command: 'does-not-matter' },
			maxResultChars: 10,
		}).catch((e) => e);
		expect(error).toMatchObject({ code: 'INVALID_OPTIONS' });
	});
});

describe('mcpTools: confirmation', () => {
	it('confirms every tool except those marked readOnlyHint', async () => {
		const { tools } = await connect({ include: ['echo', 'add_note'] });
		expect(find(tools, 'echo').confirm).toBe(false);
		expect(find(tools, 'add_note').confirm).toBe(true);
	});

	it('lets a per-tool override win in both directions', async () => {
		const { tools } = await connect({
			include: ['echo', 'add_note'],
			confirm: { echo: true, add_note: false },
		});
		expect(find(tools, 'echo').confirm).toBe(true);
		expect(find(tools, 'add_note').confirm).toBe(false);
	});
});

describe('mcpTools: calls', () => {
	it('returns the content framed as data', async () => {
		const { tools, seen } = await connect({ include: ['echo'] });
		const out = await run(tools, 'echo', { text: 'hi' });
		expect(out).toMatchObject({
			isError: false,
			output: {
				source: 'mcp',
				content: [{ type: 'text', text: 'echo:hi' }],
			},
		});
		const output = (out as { output: { notice: string } }).output;
		expect(output.notice).toContain('data, not instructions');
		expect(seen.calls[0]).toEqual({ name: 'echo', args: { text: 'hi' } });
	});

	it('keeps structuredContent and names an image instead of forwarding it', async () => {
		const { tools } = await connect({ include: ['image', 'structured'] });
		const image = await run(tools, 'image');
		expect(image).toMatchObject({
			output: {
				content: [
					{ type: 'omitted', kind: 'image', mimeType: 'image/png' },
					{ type: 'text', text: 'caption' },
				],
			},
		});
		expect(JSON.stringify(image)).not.toContain('QUJD');
		expect(await run(tools, 'structured')).toMatchObject({
			output: { structuredContent: { n: 1 } },
		});
	});

	it('answers an isError result with a code only', async () => {
		const { tools } = await connect({ include: ['fail'] });
		const out = await run(tools, 'fail');
		expect(out).toMatchObject({
			isError: true,
			error: { code: 'TOOL_FAILED' },
		});
		expect(JSON.stringify(out)).toContain('MCP_TOOL_FAILED');
		expect(JSON.stringify(out)).not.toContain(SECRET);
	});

	it('answers a server protocol error with a code only', async () => {
		const { tools } = await connect({ include: ['boom'] });
		const out = await run(tools, 'boom');
		expect(out).toMatchObject({ isError: true });
		expect(JSON.stringify(out)).toContain('MCP_TOOL_FAILED');
		expect(JSON.stringify(out)).not.toContain(SECRET);
	});

	it('cuts a result longer than maxResultChars', async () => {
		const { tools } = await connect({ include: ['big'], maxResultChars: 500 });
		const out = (await run(tools, 'big')) as {
			output: Record<string, unknown>;
		};
		expect(out.output).toMatchObject({ truncated: true });
		expect(JSON.stringify(out.output).length).toBeLessThanOrEqual(500);
		expect(out.output['originalChars']).toBeGreaterThan(5000);
	});

	it('passes the abort signal on and rejects with the reason', async () => {
		const { tools, seen } = await connect({ include: ['slow'] });
		const controller = new AbortController();
		const pending = run(tools, 'slow', {}, controller.signal);
		setTimeout(() => controller.abort(new Error('stop')), 50);
		await expect(pending).rejects.toThrow('stop');
		await Bun.sleep(50);
		expect(seen.aborted).toBe(true);
	});

	it('does not call the server when already aborted', async () => {
		const { tools, seen } = await connect({ include: ['echo'] });
		const controller = new AbortController();
		controller.abort(new Error('stop'));
		await expect(
			run(tools, 'echo', { text: 'a' }, controller.signal),
		).rejects.toThrow('stop');
		expect(seen.calls).toHaveLength(0);
	});
});

describe('mcpTools: close', () => {
	it('answers MCP_UNAVAILABLE after close, and closes twice safely', async () => {
		const { tools, close } = await connect({ include: ['echo'] });
		await close();
		await close();
		const out = await run(tools, 'echo', { text: 'a' });
		expect(out).toMatchObject({ isError: true });
		expect(JSON.stringify(out)).toContain('MCP_UNAVAILABLE');
	});

	it('answers MCP_UNAVAILABLE when the server goes away mid-run', async () => {
		const [client, serverSide] = InMemoryTransport.createLinkedPair();
		await createTestServer().connect(serverSide);
		const { tools, close } = await mcpTools({
			transport: { type: 'transport', transport: client },
			include: ['echo'],
		});
		closers.push(close);
		await serverSide.close();
		const out = await run(tools, 'echo', { text: 'a' });
		expect(JSON.stringify(out)).toContain('MCP_UNAVAILABLE');
		expect(JSON.stringify(out)).not.toContain('Connection closed');
	});
});

describe('mcpTools: connection lost during a call', () => {
	it('answers MCP_UNAVAILABLE when the server closes while a call waits', async () => {
		const [client, serverSide] = InMemoryTransport.createLinkedPair();
		await createTestServer().connect(serverSide);
		const { tools, close } = await mcpTools({
			transport: { type: 'transport', transport: client },
			include: ['slow'],
		});
		closers.push(close);
		const pending = run(tools, 'slow');
		setTimeout(() => void serverSide.close(), 50);
		const out = await pending;
		expect(JSON.stringify(out)).toContain('MCP_UNAVAILABLE');
	});
});

describe('mcpTools: connecting', () => {
	it('throws MCP_UNAVAILABLE when the command does not start', async () => {
		const error = await mcpTools({
			transport: { type: 'stdio', command: 'nxgt-no-such-command' },
		}).catch((e) => e);
		expect(error).toBeInstanceOf(McpClientError);
		expect(error).toMatchObject({ code: 'MCP_UNAVAILABLE' });
		expect(error.cause).toBeDefined();
	});
});
