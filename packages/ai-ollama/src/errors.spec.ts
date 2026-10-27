import { describe, expect, test } from 'bun:test';
import { AiError, type ModelRequest } from '@nxgt/ai-core';
import { OllamaError } from './errors';
import { events, setup } from './test-helpers';

const req: ModelRequest = {
	messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
};

const fail = async (response: Response | Error) => {
	const { model } = setup([response]);
	return events(model, req).then(
		() => undefined,
		(e: unknown) => e as OllamaError,
	);
};
const err = (status: number, body: string) =>
	new Response(body, { status, statusText: 'Status' });

describe('errors', () => {
	test('connection refused names the server and the fix', async () => {
		const e = await fail(
			new TypeError(
				'Unable to connect. Is the computer able to access the url?',
			),
		);
		expect(e).toBeInstanceOf(OllamaError);
		expect(e).toBeInstanceOf(AiError);
		expect(e).toMatchObject({ kind: 'unreachable', code: 'MODEL_ERROR' });
		expect(e?.message).toContain('http://localhost:11434');
		expect(e?.message).toContain('ollama serve');
		expect(e?.cause).toBeInstanceOf(TypeError);
	});

	test('a missing model says to pull it', async () => {
		const e = await fail(err(404, '{"error":"model \'nope\' not found"}'));
		expect(e).toMatchObject({
			kind: 'model-not-found',
			code: 'MODEL_ERROR',
			status: 404,
		});
		expect(e?.message).toContain("model 'nope' not found");
		expect(e?.message).toContain('ollama pull');
	});

	test.each([
		[401, 'auth', 'AUTHENTICATION'],
		[403, 'auth', 'AUTHENTICATION'],
		[429, 'rate-limited', 'RATE_LIMITED'],
		[500, 'provider', 'MODEL_ERROR'],
		[503, 'provider', 'MODEL_ERROR'],
		[400, 'bad-request', 'MODEL_ERROR'],
		[404, 'bad-request', 'MODEL_ERROR'],
	] as const)('HTTP %d is %s / %s', async (status, kind, code) => {
		const e = await fail(err(status, '{"error":"nope"}'));
		expect(e).toMatchObject({ kind, code, status });
		expect(e?.message).toContain('nope');
	});

	test('a body that is not JSON is quoted, or the status text used', async () => {
		expect((await fail(err(502, 'Bad Gateway')))?.message).toContain(
			'Bad Gateway',
		);
		expect((await fail(err(502, '')))?.message).toContain('Status');
	});
});
