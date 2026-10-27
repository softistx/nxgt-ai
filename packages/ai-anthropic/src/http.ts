import { AnthropicError, errorFromResponse } from './errors';

export interface HttpOptions {
	url: string;
	headers: Record<string, string>;
	maxRetries: number;
	fetch: typeof fetch;
	sleep: (ms: number, signal: AbortSignal) => Promise<void>;
	now: () => number;
	random: () => number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;
/** A longer `retry-after` is reported, not waited out. */
export const MAX_RETRY_AFTER_MS = 60_000;

export function backoffMs(attempt: number, random: number): number {
	const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
	return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

async function attemptOnce(
	o: HttpOptions,
	body: string,
	signal: AbortSignal,
): Promise<Response> {
	let res: Response;
	try {
		res = await o.fetch(o.url, {
			method: 'POST',
			headers: o.headers,
			body,
			signal,
		});
	} catch (cause) {
		if (signal.aborted) throw cause;
		throw new AnthropicError({
			kind: 'network',
			code: 'MODEL_ERROR',
			message: `Anthropic request failed: ${(cause as Error).message}`,
			cause,
		});
	}
	if (res.ok) return res;
	throw await errorFromResponse(res, o.now());
}

/**
 * POSTs `body`, retrying 429, 529, 5xx and network failures up to
 * `maxRetries` times. Waits `retry-after` when given, else a jittered
 * exponential backoff. Resolves `undefined` when `signal` aborts.
 */
export async function post(
	o: HttpOptions,
	body: unknown,
	signal: AbortSignal,
): Promise<Response | undefined> {
	const json = JSON.stringify(body);
	for (let attempt = 0; ; attempt++) {
		if (signal.aborted) return undefined;
		try {
			return await attemptOnce(o, json, signal);
		} catch (error) {
			if (signal.aborted) return undefined;
			if (!(error instanceof AnthropicError) || !error.retryable) throw error;
			const wait = error.retryAfterMs ?? backoffMs(attempt, o.random());
			if (attempt >= o.maxRetries || wait > MAX_RETRY_AFTER_MS) throw error;
			try {
				await o.sleep(wait, signal);
			} catch {
				return undefined;
			}
		}
	}
}
