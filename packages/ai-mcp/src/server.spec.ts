import { afterEach, describe, expect, it } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AiError, defineTool, executeTool } from '@nxgt/ai-core';
import { z } from 'zod';
import {
	SECRET,
	type ServerSeen,
	safeTools,
	serverTools,
} from '../test/server-tools';
import { mcpTools } from './client';
import { MCP_SERVER_ERROR_CODES, McpServerError, mcpServer } from './server';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(closers.splice(0).map((c) => c()));
});

const call = (name: string, input: unknown = {}) => ({
	type: 'tool-call' as const,
	id: 'c',
	name,
	input,
});

/** The server on one end of an in-memory pair, a raw SDK client on the other. */
async function rawClient(
	options: Partial<Parameters<typeof mcpServer>[0]> = {},
) {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const served = await mcpServer({
		tools: safeTools(),
		name: 'spec',
		version: '1.2.3',
		...options,
	}).connect(serverSide);
	const client = new Client({ name: 'raw', version: '0.0.0' });
	await client.connect(clientSide);
	closers.push(async () => {
		await client.close();
		await served.close();
	});
	return client;
}

describe('mcpServer', () => {
	it('lists tools with names, descriptions, schemas and readOnlyHint', async () => {
		const client = await rawClient();
		expect(client.getServerVersion()).toMatchObject({
			name: 'spec',
			version: '1.2.3',
		});
		const { tools } = await client.listTools();
		const source = safeTools();
		expect(tools.map((t) => t.name)).toEqual(source.map((t) => t.name));
		const echo = tools.find((t) => t.name === 'echo');
		expect(echo?.description).toBe('Repeats the text');
		expect(echo?.inputSchema).toEqual(source[0]?.inputSchema as never);
		expect(echo?.annotations?.readOnlyHint).toBe(true);
	});

	it('round-trips with the S18 client over an in-memory transport', async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const served = await mcpServer({
			tools: safeTools(),
			name: 'spec',
			version: '1.0.0',
		}).connect(serverSide);
		const { tools, close } = await mcpTools({
			transport: { type: 'transport', transport: clientSide },
		});
		closers.push(async () => {
			await close();
			await served.close();
		});
		const source = safeTools();
		expect(tools.map((t) => t.name)).toEqual(source.map((t) => t.name));
		for (const tool of tools) {
			const original = source.find((t) => t.name === tool.name);
			expect(tool.description).toBe(original?.description as string);
			expect(tool.inputSchema).toEqual(original?.inputSchema as never);
			expect(tool.confirm).toBe(false);
		}
		const echo = tools.find((t) => t.name === 'echo');
		if (!echo) throw new Error('no tool');
		const out = await executeTool(echo, call('echo', { text: 'hi' }));
		expect(out).toMatchObject({
			isError: false,
			output: {
				// The text only repeats structuredContent, so the client drops it.
				content: [],
				structuredContent: { echoed: 'hi' },
			},
		});
	});

	it('answers invalid input with an isError code', async () => {
		const client = await rawClient();
		const result = await client.callTool({
			name: 'echo',
			arguments: { text: 42 },
		});
		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: 'text', text: '{"code":"INVALID_TOOL_INPUT"}' },
		]);
	});

	it('answers an unknown tool with a code', async () => {
		const client = await rawClient();
		const result = await client.callTool({ name: 'nope', arguments: {} });
		expect(result).toMatchObject({
			isError: true,
			content: [{ type: 'text', text: '{"code":"UNKNOWN_TOOL"}' }],
		});
	});

	it('never leaks a thrown error', async () => {
		const client = await rawClient();
		const result = await client.callTool({ name: 'explode', arguments: {} });
		expect(result).toEqual({
			isError: true,
			content: [{ type: 'text', text: '{"code":"TOOL_FAILED"}' }],
		});
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it('passes the abort signal to the tool when the client cancels', async () => {
		const seen: ServerSeen = { aborted: false, started: false };
		const client = await rawClient({ tools: safeTools(seen) });
		const controller = new AbortController();
		const pending = client.callTool(
			{ name: 'slow', arguments: {} },
			undefined,
			{
				signal: controller.signal,
			},
		);
		pending.catch(() => {});
		while (!seen.started) await Bun.sleep(5);
		controller.abort();
		await expect(pending).rejects.toBeDefined();
		const deadline = Date.now() + 2000;
		while (!seen.aborted && Date.now() < deadline) await Bun.sleep(10);
		expect(seen.aborted).toBe(true);
	});

	it('builds the context for each call, with no request over a transport', async () => {
		let n = 0;
		const infos: unknown[] = [];
		const client = await rawClient({
			context: (info) => {
				infos.push(info);
				return `viewer-${++n}`;
			},
		});
		const a = await client.callTool({ name: 'whoami', arguments: {} });
		const b = await client.callTool({ name: 'whoami', arguments: {} });
		expect(a.structuredContent).toEqual({ viewer: 'viewer-1' });
		expect(b.structuredContent).toEqual({ viewer: 'viewer-2' });
		expect(infos).toEqual([{}, {}]);
	});

	it('answers TOOL_FAILED when context throws, without its message', async () => {
		const client = await rawClient({
			context: () => {
				throw new Error(SECRET);
			},
		});
		const result = await client.callTool({ name: 'whoami', arguments: {} });
		expect(JSON.stringify(result)).not.toContain(SECRET);
		expect(result).toMatchObject({ isError: true });
	});

	it('works when connect is destructured', async () => {
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const { connect } = mcpServer({
			tools: safeTools(),
			name: 'spec',
			version: '1',
		});
		const served = await connect(serverSide);
		const client = new Client({ name: 'raw', version: '0.0.0' });
		await client.connect(clientSide);
		closers.push(async () => {
			await client.close();
			await served.close();
		});
		expect((await client.listTools()).tools.length).toBeGreaterThan(0);
	});

	describe('codes and outputs', () => {
		const tools = [
			defineTool({
				name: 'limited',
				description: 'Throws an AiError',
				input: z.object({}),
				execute: () => {
					throw new AiError('RATE_LIMITED', 'internal detail SECRET');
				},
			}),
			defineTool({
				name: 'bad_output',
				description: 'Returns the wrong shape',
				input: z.object({}),
				output: z.object({ n: z.number() }),
				execute: () => ({ n: 'x' }) as never,
			}),
			defineTool({
				name: 'text',
				description: 'Returns a string',
				input: z.object({}),
				execute: () => 'plain words',
			}),
			defineTool({
				name: 'list',
				description: 'Returns an array',
				input: z.object({}),
				execute: () => [1, 2],
			}),
			defineTool({
				name: 'slow_ignoring',
				description: 'Ignores its signal',
				input: z.object({}),
				execute: async () => {
					await Bun.sleep(1000);
					return 'late';
				},
			}),
		];

		it('passes the code of a thrown AiError, nothing else', async () => {
			const client = await rawClient({ tools });
			const result = await client.callTool({ name: 'limited', arguments: {} });
			expect(result).toEqual({
				isError: true,
				content: [{ type: 'text', text: '{"code":"RATE_LIMITED"}' }],
			});
		});

		it('answers INVALID_TOOL_OUTPUT when the output breaks its schema', async () => {
			const client = await rawClient({ tools });
			const result = await client.callTool({
				name: 'bad_output',
				arguments: {},
			});
			expect(result).toEqual({
				isError: true,
				content: [{ type: 'text', text: '{"code":"INVALID_TOOL_OUTPUT"}' }],
			});
		});

		it('sends a string as is and an array as JSON, without structuredContent', async () => {
			const client = await rawClient({ tools });
			const text = await client.callTool({ name: 'text', arguments: {} });
			expect(text.content).toEqual([{ type: 'text', text: 'plain words' }]);
			expect(text.structuredContent).toBeUndefined();
			const list = await client.callTool({ name: 'list', arguments: {} });
			expect(list.content).toEqual([{ type: 'text', text: '[1,2]' }]);
			expect(list.structuredContent).toBeUndefined();
		});

		it('answers TOOL_TIMEOUT once timeoutMs passes, even if the tool ignores its signal', async () => {
			const client = await rawClient({ tools, timeoutMs: 50 });
			const started = Date.now();
			const result = await client.callTool({
				name: 'slow_ignoring',
				arguments: {},
			});
			expect(Date.now() - started).toBeLessThan(800);
			expect(result).toEqual({
				isError: true,
				content: [{ type: 'text', text: '{"code":"TOOL_TIMEOUT"}' }],
			});
		});

		it('aborts the signal of a tool that times out', async () => {
			const seen: ServerSeen = { aborted: false, started: false };
			const client = await rawClient({
				tools: safeTools(seen),
				timeoutMs: 50,
			});
			const result = await client.callTool({ name: 'slow', arguments: {} });
			expect(result.content).toEqual([
				{ type: 'text', text: '{"code":"TOOL_TIMEOUT"}' },
			]);
			expect(seen.aborted).toBe(true);
		});

		it('refuses a timeoutMs that is not positive', () => {
			expect(() =>
				mcpServer({ tools, name: 'n', version: '1', timeoutMs: 0 }),
			).toThrow(McpServerError);
		});
	});

	describe('confirm tools', () => {
		it('refuses to serve one by default', () => {
			let error: unknown;
			try {
				mcpServer({ tools: serverTools(), name: 's', version: '1' });
			} catch (e) {
				error = e;
			}
			expect(error).toBeInstanceOf(McpServerError);
			expect(error).toMatchObject({
				code: 'INVALID_OPTIONS',
				tool: 'delete_all',
			});
			expect(MCP_SERVER_ERROR_CODES).toContain('INVALID_OPTIONS');
		});

		it('serves it with allowConfirmTools, without readOnlyHint', async () => {
			const client = await rawClient({
				tools: serverTools(),
				allowConfirmTools: true,
			});
			const { tools } = await client.listTools();
			expect(tools.find((t) => t.name === 'delete_all')?.annotations).toBe(
				undefined,
			);
			expect(tools.find((t) => t.name === 'echo')?.annotations).toEqual({
				readOnlyHint: true,
			});
		});
	});

	it('refuses duplicate names and a missing name or version', () => {
		const [echo] = safeTools();
		if (!echo) throw new Error('no tool');
		expect(() =>
			mcpServer({ tools: [echo, echo], name: 's', version: '1' }),
		).toThrow(McpServerError);
		expect(() => mcpServer({ tools: [], name: '', version: '1' })).toThrow(
			McpServerError,
		);
	});
});
