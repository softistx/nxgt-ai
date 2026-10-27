import { readFileSync } from 'node:fs';
import type { ModelAdapter, ModelEvent, ModelRequest } from '@nxgt/ai-core';
import { type OllamaOptions, ollama } from './ollama';

export const fixture = (name: string): string =>
	readFileSync(new URL(`./fixtures/${name}.ndjson`, import.meta.url), 'utf8');

export interface Call {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}

/** A fake `fetch` answering with `responses` in order; records each call. */
export function fakeFetch(responses: Array<Response | Error>) {
	const calls: Call[] = [];
	const impl = async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({
			url: String(url),
			headers: init?.headers as Record<string, string>,
			body: JSON.parse(String(init?.body)),
		});
		const next = responses[calls.length - 1] ?? responses.at(-1);
		if (next instanceof Error) throw next;
		return (next as Response).clone();
	};
	return { calls, fetch: impl as unknown as typeof fetch };
}

export function setup(
	responses: Array<Response | Error>,
	options: Partial<OllamaOptions> = {},
) {
	const f = fakeFetch(responses);
	let n = 0;
	const model: ModelAdapter = ollama({
		model: 'llama-test',
		fetch: f.fetch,
		newId: () => `call_${++n}`,
		...options,
	});
	return { ...f, model };
}

export const run = (
	model: ModelAdapter,
	req: ModelRequest,
	signal?: AbortSignal,
) => model.stream(req, signal ?? new AbortController().signal);

export async function events(
	model: ModelAdapter,
	req: ModelRequest,
	signal?: AbortSignal,
): Promise<ModelEvent[]> {
	const out: ModelEvent[] = [];
	for await (const e of run(model, req, signal)) out.push(e);
	return out;
}

/** `text` as UTF-8 bytes cut into chunks of `size` bytes. */
export function chunked(text: string, size: number): Uint8Array[] {
	const bytes = new TextEncoder().encode(text);
	const out: Uint8Array[] = [];
	for (let i = 0; i < bytes.length; i += size)
		out.push(bytes.slice(i, i + size));
	return out;
}

export const bytesStream = (chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
	new ReadableStream({
		start(controller) {
			for (const c of chunks) controller.enqueue(c);
			controller.close();
		},
	});

/** A 200 `application/x-ndjson` response delivering `chunks`. */
export const ndjson = (
	chunks: Uint8Array[],
	init: ResponseInit = {},
): Response =>
	new Response(bytesStream(chunks), {
		status: 200,
		headers: { 'content-type': 'application/x-ndjson' },
		...init,
	});
