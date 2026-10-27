import { AiError, type AiErrorCode } from '@nxgt/ai-core';

/** What went wrong, finer than the `AiError` code. */
export type OllamaErrorKind =
	| 'unreachable'
	| 'model-not-found'
	| 'auth'
	| 'bad-request'
	| 'rate-limited'
	| 'provider'
	| 'protocol';

export interface OllamaErrorInit {
	kind: OllamaErrorKind;
	code: AiErrorCode;
	message: string;
	status?: number;
	cause?: unknown;
}

/** An `AiError` that also says which failure it was. */
export class OllamaError extends AiError {
	override name = 'OllamaError';
	readonly kind: OllamaErrorKind;
	readonly status: number | undefined;

	constructor(init: OllamaErrorInit) {
		super(
			init.code,
			init.message,
			init.cause === undefined ? {} : { cause: init.cause },
		);
		this.kind = init.kind;
		this.status = init.status;
	}
}

/** The server is not running or not reachable at `baseUrl`. */
export function unreachable(baseUrl: string, cause: unknown): OllamaError {
	return new OllamaError({
		kind: 'unreachable',
		code: 'MODEL_ERROR',
		message: `Cannot reach Ollama at ${baseUrl}: is \`ollama serve\` running? (${(cause as Error).message})`,
		cause,
	});
}

/** A failure Ollama reports in a `{ "error": "..." }` line, mid-stream. */
export function streamError(message: string): OllamaError {
	return new OllamaError({
		kind: 'provider',
		code: 'MODEL_ERROR',
		message: `Ollama error: ${message}`,
	});
}

async function apiMessage(res: Response): Promise<string> {
	const text = await res.text().catch(() => '');
	try {
		const body = JSON.parse(text) as { error?: unknown };
		if (typeof body.error === 'string') return body.error;
	} catch {
		// not JSON: fall through to the raw text
	}
	return text.slice(0, 500) || res.statusText;
}

function classify(
	status: number,
	message: string,
): Pick<OllamaErrorInit, 'kind' | 'code'> {
	if (status === 401 || status === 403)
		return { kind: 'auth', code: 'AUTHENTICATION' };
	if (status === 404 && /not found/i.test(message))
		return { kind: 'model-not-found', code: 'MODEL_ERROR' };
	if (status === 429) return { kind: 'rate-limited', code: 'RATE_LIMITED' };
	if (status >= 500) return { kind: 'provider', code: 'MODEL_ERROR' };
	return { kind: 'bad-request', code: 'MODEL_ERROR' };
}

/** Maps a non-2xx response to an `OllamaError`. */
export async function errorFromResponse(res: Response): Promise<OllamaError> {
	const message = await apiMessage(res);
	const hint = /not found/i.test(message) ? ' (run `ollama pull <model>`)' : '';
	return new OllamaError({
		...classify(res.status, message),
		message: `Ollama API ${res.status}: ${message}${hint}`,
		status: res.status,
	});
}
