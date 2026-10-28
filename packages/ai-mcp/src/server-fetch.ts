import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

/** The SDK's own limit for a request body. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

const rpcError = (status: number, code: number, message: string) =>
	Response.json(
		{ jsonrpc: '2.0', error: { code, message }, id: null },
		{ status },
	);

/** Reads the body once, up to `MAX_BODY_BYTES`; `undefined` when it is larger. */
async function readCapped(request: Request): Promise<string | undefined> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined;
	if (!request.body) return '';
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Stateless Streamable HTTP for one request: `POST` only, a body capped at
 * 4 MiB (413), no JSON-RPC batch (400), parsed once and handed to the SDK
 * transport. `build` makes the per-request `Server`, closed when done.
 */
export async function serveFetch(
	request: Request,
	build: (requestSignal: AbortSignal) => Server,
): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { Allow: 'POST' } });
	}
	const text = await readCapped(request);
	if (text === undefined) {
		return rpcError(413, -32600, 'The request body is larger than 4 MiB.');
	}
	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(text);
	} catch {
		return rpcError(400, -32700, 'The request body is not valid JSON.');
	}
	if (Array.isArray(parsedBody)) {
		return rpcError(
			400,
			-32600,
			'JSON-RPC batches are not supported: send one message per request.',
		);
	}
	const server = build(request.signal);
	try {
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return await transport.handleRequest(request, { parsedBody });
	} finally {
		await server.close();
	}
}
