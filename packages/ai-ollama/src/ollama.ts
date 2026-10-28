import type { ModelAdapter, ModelEvent, ModelRequest } from '@nxgt/ai-core';
import { errorFromResponse, unreachable } from './errors';
import { buildBody, type Think } from './request';
import { eventsFromStream } from './stream';

export interface OllamaOptions {
	/** A model already pulled, such as `llama3.2`. */
	model: string;
	/** Default `http://localhost:11434`. */
	baseUrl?: string;
	/** How long the model stays loaded after a call: `'10m'`, seconds, `-1`. */
	keepAlive?: string | number;
	/** Thinking models: `true`, or a level. Default: on when a request asks. */
	think?: Think;
	/** Context window in tokens (`options.num_ctx`); the server default is small. */
	numCtx?: number;
	/** For tests: replaces the global `fetch`. */
	fetch?: typeof fetch;
	/** For tests: replaces the generator of tool call ids. */
	newId?: () => string;
}

/** A `ModelAdapter` for a local Ollama server (`POST /api/chat`). */
export function ollama(options: OllamaOptions): ModelAdapter {
	const baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(
		/\/+$/,
		'',
	);
	const doFetch = options.fetch ?? fetch;
	const newId = options.newId ?? (() => `call_${crypto.randomUUID()}`);

	async function* stream(
		req: ModelRequest,
		signal: AbortSignal,
	): AsyncGenerator<ModelEvent> {
		if (signal.aborted) return;
		const body = buildBody(
			{
				model: options.model,
				keepAlive: options.keepAlive,
				think: options.think,
				numCtx: options.numCtx,
			},
			req,
		);
		let res: Response;
		try {
			res = await doFetch(`${baseUrl}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal,
			});
		} catch (cause) {
			if (signal.aborted) return;
			throw unreachable(baseUrl, cause);
		}
		if (!res.ok) throw await errorFromResponse(res);
		yield* eventsFromStream(res, signal, newId);
	}

	return { provider: 'ollama', model: options.model, stream };
}
