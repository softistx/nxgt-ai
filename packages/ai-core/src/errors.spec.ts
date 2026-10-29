import { describe, expect, test } from 'bun:test';
import { AiError, cleanErrorDetails } from './errors';

describe('cleanErrorDetails', () => {
	test('keeps a plain code with its path, fields and scalar params', () => {
		expect(
			cleanErrorDetails([
				{
					code: 'validation.errors.invalid-input',
					path: ['createItem', 0],
					fields: ['name'],
					params: { max: 5, ok: true, who: 'x' },
				},
			]),
		).toEqual([
			{
				code: 'validation.errors.invalid-input',
				path: ['createItem', 0],
				fields: ['name'],
				params: { max: 5, ok: true, who: 'x' },
			},
		]);
	});

	test('drops an entry without a plain code, and anything beyond a scalar', () => {
		const kept = cleanErrorDetails([
			{ code: 'has space' },
			{ message: 'no code' },
			'text',
			{ code: 'NOT_FOUND', message: 'row 42', params: { o: { a: 1 }, n: 1 } },
		]);
		expect(kept).toEqual([{ code: 'NOT_FOUND', params: { n: 1 } }]);
	});

	test('answers [] for anything but a list and caps the list at 50', () => {
		expect(cleanErrorDetails(undefined)).toEqual([]);
		expect(cleanErrorDetails({ code: 'X' })).toEqual([]);
		expect(
			cleanErrorDetails(Array.from({ length: 80 }, () => ({ code: 'X' }))),
		).toHaveLength(50);
	});
});

describe('AiError details', () => {
	test('are empty by default and cleaned when given', () => {
		expect(new AiError('TOOL_FAILED', 'x').details).toEqual([]);
		const error = new AiError('TOOL_FAILED', 'x', {
			details: [{ code: 'a b' }, { code: 'CONFLICT' }],
		});
		expect(error.details).toEqual([{ code: 'CONFLICT' }]);
	});
});

describe('agentEventSchema details', () => {
	test('a tool-result error keeps cleaned details', async () => {
		const { agentEventSchema } = await import('./events');
		const parsed = agentEventSchema.parse({
			type: 'tool-result',
			result: {
				type: 'tool-result',
				callId: 'c',
				name: 'n',
				isError: true,
				error: {
					code: 'TOOL_FAILED',
					message: 'x',
					details: [{ code: 'CONFLICT', message: 'leak' }, { code: 'a b' }],
				},
			},
		});
		expect(JSON.stringify(parsed)).toContain('"details":[{"code":"CONFLICT"}]');
		expect(JSON.stringify(parsed)).not.toContain('leak');
	});
});
