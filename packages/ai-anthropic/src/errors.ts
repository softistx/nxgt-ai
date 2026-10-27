import { AiError, type AiErrorCode } from '@nxgt/ai-core';

/** What went wrong, finer than the `AiError` code. */
export type AnthropicErrorKind =
	| 'auth'
	| 'bad-request'
	| 'rate-limited'
	| 'overloaded'
	| 'provider'
	| 'network';

export interface AnthropicErrorInit {
	kind: AnthropicErrorKind;
	code: AiErrorCode;
	message: string;
	status?: number;
	/** Milliseconds the API asked to wait (`retry-after`). */
	retryAfterMs?: number;
	requestId?: string;
	cause?: unknown;
}

/** An `AiError` that also says which HTTP failure it was. */
export class AnthropicError extends AiError {
	override name = 'AnthropicError';
	readonly kind: AnthropicErrorKind;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;
	readonly requestId: string | undefined;

	constructor(init: AnthropicErrorInit) {
		super(
			init.code,
			init.message,
			init.cause === undefined ? {} : { cause: init.cause },
		);
		this.kind = init.kind;
		this.status = init.status;
		this.retryAfterMs = init.retryAfterMs;
		this.requestId = init.requestId;
	}

	/** True for 429, 529, 5xx and network failures. */
	get retryable(): boolean {
		return (
			this.kind === 'rate-limited' ||
			this.kind === 'overloaded' ||
			this.kind === 'provider' ||
			this.kind === 'network'
		);
	}
}

/** `retry-after` as milliseconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(
	value: string | null,
	now: number,
): number | undefined {
	if (value === null || value.trim() === '') return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

async function apiMessage(res: Response): Promise<string> {
	const text = await res.text().catch(() => '');
	try {
		const body = JSON.parse(text) as { error?: { message?: unknown } };
		if (typeof body.error?.message === 'string') return body.error.message;
	} catch {
		// not JSON: fall through to the raw text
	}
	return text.slice(0, 500) || res.statusText;
}

function classify(status: number): Pick<AnthropicErrorInit, 'kind' | 'code'> {
	if (status === 401 || status === 403)
		return { kind: 'auth', code: 'AUTHENTICATION' };
	if (status === 429) return { kind: 'rate-limited', code: 'RATE_LIMITED' };
	if (status === 529) return { kind: 'overloaded', code: 'MODEL_ERROR' };
	if (status >= 500) return { kind: 'provider', code: 'MODEL_ERROR' };
	return { kind: 'bad-request', code: 'MODEL_ERROR' };
}

/** Maps a non-2xx response to an `AnthropicError`. */
export async function errorFromResponse(
	res: Response,
	now: number,
): Promise<AnthropicError> {
	const message = await apiMessage(res);
	const init: AnthropicErrorInit = {
		...classify(res.status),
		message: `Anthropic API ${res.status}: ${message}`,
		status: res.status,
	};
	const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now);
	if (retryAfterMs !== undefined) init.retryAfterMs = retryAfterMs;
	const requestId = res.headers.get('request-id');
	if (requestId !== null) init.requestId = requestId;
	return new AnthropicError(init);
}
