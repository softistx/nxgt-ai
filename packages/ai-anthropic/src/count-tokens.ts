import { AiError, type ModelRequest } from '@nxgt/ai-core';
import { AnthropicError } from './errors';
import { type HttpOptions, post } from './http';
import { buildBody } from './request';

/**
 * Input tokens of `req` via `POST /v1/messages/count_tokens`, with the same
 * retries as a call. Sampling and output fields are not part of the count.
 */
export async function countTokens(
	http: HttpOptions,
	model: string,
	req: ModelRequest,
	signal: AbortSignal,
): Promise<number> {
	const { max_tokens: _m, temperature: _t, ...body } = buildBody(model, req);
	const res = await post(http, body, signal);
	if (res === undefined) throw new AiError('ABORTED', 'The call was aborted');
	let parsed: { input_tokens?: unknown };
	try {
		parsed = (await res.json()) as typeof parsed;
	} catch (cause) {
		throw new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: 'Anthropic count_tokens returned a body that is not JSON',
			status: res.status,
			cause,
		});
	}
	if (typeof parsed.input_tokens !== 'number') {
		throw new AnthropicError({
			kind: 'provider',
			code: 'MODEL_ERROR',
			message: 'Anthropic count_tokens returned no input_tokens',
			status: res.status,
		});
	}
	return parsed.input_tokens;
}
