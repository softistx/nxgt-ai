import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpClientError } from './errors';
import type { McpToolsOptions } from './options';
import { createTransport } from './transport';

export interface ListedTool {
	name: string;
	description?: string | undefined;
	inputSchema: unknown;
	annotations?: { readOnlyHint?: boolean | undefined } | undefined;
}

/** A server that pages forever must not hold the caller forever. */
export const MAX_PAGES = 100;
export const MAX_TOOLS = 1000;

async function listAll(
	client: Client,
	signal: AbortSignal | undefined,
): Promise<ListedTool[]> {
	const all: ListedTool[] = [];
	const cursors = new Set<string>();
	let cursor: string | undefined;
	for (let pages = 0; ; pages++) {
		if (pages >= MAX_PAGES) throw new Error(`more than ${MAX_PAGES} pages`);
		const page = await client.listTools(
			cursor === undefined ? {} : { cursor },
			signal ? { signal } : undefined,
		);
		all.push(...(page.tools as ListedTool[]));
		if (all.length > MAX_TOOLS) throw new Error(`more than ${MAX_TOOLS} tools`);
		cursor = page.nextCursor;
		if (!cursor) return all;
		if (cursors.has(cursor)) throw new Error('a cursor came back twice');
		cursors.add(cursor);
	}
}

/**
 * Connects the client and lists every tool. Throws `McpClientError`
 * (`MCP_UNAVAILABLE`, `MCP_LIST_FAILED`); the caller closes the client.
 */
export async function connectAndList(
	client: Client,
	options: McpToolsOptions,
): Promise<ListedTool[]> {
	try {
		await client.connect(
			createTransport(options.transport),
			options.signal ? { signal: options.signal } : undefined,
		);
	} catch (cause) {
		if (cause instanceof McpClientError) throw cause;
		throw new McpClientError(
			'MCP_UNAVAILABLE',
			'Could not connect to the MCP server.',
			{ cause },
		);
	}
	try {
		return await listAll(client, options.signal);
	} catch (cause) {
		throw new McpClientError(
			'MCP_LIST_FAILED',
			'The MCP server did not list its tools.',
			{ cause },
		);
	}
}

/** The tools to expose: the `include` allow-list in its order, else all. */
export function selectTools(
	listed: ListedTool[],
	include: readonly string[] | undefined,
): ListedTool[] {
	if (!include) return listed;
	const byName = new Map(listed.map((t) => [t.name, t]));
	return include.map((name) => {
		const found = byName.get(name);
		if (!found) {
			throw new McpClientError(
				'UNKNOWN_TOOL',
				`The MCP server lists no tool named "${name.slice(0, 100)}".`,
				{ tool: name },
			);
		}
		return found;
	});
}
