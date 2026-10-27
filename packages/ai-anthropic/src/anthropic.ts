import type { ModelAdapter, ModelEvent, ModelRequest } from '@nxgt/ai-core';
import { countTokens } from './count-tokens';
import { AnthropicError } from './errors';
import { type HttpOptions, post } from './http';
import { buildBody } from './request';
import { eventsFromMessage } from './response';
import { realSleep } from './sleep';
import { eventsFromStream } from './stream';

export interface AnthropicOptions {
	apiKey: string;
	model: string;
	/** Default `https://api.anthropic.com`. */
	baseUrl?: string;
	/** Retries after the first attempt. Default 2; 0 disables them. */
	maxRetries?: number;
	/** `anthropic-version` header. Default `2023-06-01`. */
	version?: string;
	/** `anthropic-beta` feature flags, sent comma-joined. */
	beta?: readonly string[];
	/** For tests: replaces the global `fetch`. */
	fetch?: typeof fetch;
	/** For tests: replaces the real wait between retries. */
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	/** For tests: replaces `Date.now`, used for an HTTP-date `retry-after`. */
	now?: () => number;
	/** For tests: replaces `Math.random`, the backoff jitter. */
	random?: () => number;
}

/** A `ModelAdapter` for the Anthropic Messages API. */
export function anthropic(options: AnthropicOptions): ModelAdapter {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-api-key': options.apiKey,
		'anthropic-version': options.version ?? '2023-06-01',
	};
	if (options.beta && options.beta.length > 0)
		headers['anthropic-beta'] = options.beta.join(',');
	const http: HttpOptions = {
		url: `${(options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`,
		headers,
		maxRetries: options.maxRetries ?? 2,
		fetch: options.fetch ?? fetch,
		sleep: options.sleep ?? realSleep,
		now: options.now ?? Date.now,
		random: options.random ?? Math.random,
	};

	async function* stream(
		req: ModelRequest,
		signal: AbortSignal,
	): AsyncGenerator<ModelEvent> {
		const res = await post(
			http,
			{ ...buildBody(options.model, req), stream: true },
			signal,
		);
		if (res === undefined) return;
		if (!res.headers.get('content-type')?.includes('application/json')) {
			yield* eventsFromStream(res, signal);
			return;
		}
		// A gateway that ignores `stream: true` answers with one JSON message.
		let body: Parameters<typeof eventsFromMessage>[0];
		try {
			body = (await res.json()) as typeof body;
		} catch (cause) {
			if (signal.aborted) return;
			throw new AnthropicError({
				kind: 'provider',
				code: 'MODEL_ERROR',
				message: 'Anthropic API returned a body that is not JSON',
				status: res.status,
				cause,
			});
		}
		yield* eventsFromMessage(body);
	}

	const countHttp: HttpOptions = { ...http, url: `${http.url}/count_tokens` };

	return {
		provider: 'anthropic',
		model: options.model,
		stream,
		countTokens: (req, signal = new AbortController().signal) =>
			countTokens(countHttp, options.model, req, signal),
	};
}
