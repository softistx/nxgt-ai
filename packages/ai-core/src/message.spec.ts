import { describe, expect, test } from 'bun:test';
import {
	AiError,
	addUsage,
	emptyUsage,
	errorResult,
	type Message,
	type Part,
} from './index';

describe('parts and messages', () => {
	test('each part type narrows on `type`', () => {
		const parts: Part[] = [
			{ type: 'text', text: 'hi' },
			{ type: 'thinking', text: 'hmm', signature: 'sig' },
			{ type: 'tool-call', id: 'c1', name: 'weather', input: { city: 'Lyon' } },
			{
				type: 'tool-result',
				callId: 'c1',
				name: 'weather',
				isError: false,
				output: 18,
			},
			{
				type: 'tool-result',
				callId: 'c2',
				name: 'weather',
				isError: true,
				error: { code: 'TOOL_FAILED', message: 'x' },
			},
			{
				type: 'proposed-action',
				id: 'a1',
				tool: 'delete_note',
				input: { id: 'n' },
				summary: 'Delete n',
				expiresAt: 9,
			},
		];
		const labels = parts.map((part) => {
			switch (part.type) {
				case 'text':
					return part.text;
				case 'thinking':
					return part.signature;
				case 'tool-call':
					return part.name;
				case 'tool-result':
					return part.isError ? part.error.code : String(part.output);
				case 'proposed-action':
					return part.summary;
				default:
					return part satisfies never;
			}
		});
		expect(labels).toEqual([
			'hi',
			'sig',
			'weather',
			'18',
			'TOOL_FAILED',
			'Delete n',
		]);
	});

	test('a message survives a JSON round trip', () => {
		const message: Message = {
			role: 'assistant',
			parts: [
				{
					type: 'tool-call',
					id: 'c1',
					name: 'weather',
					input: { city: 'Lyon' },
				},
			],
		};
		expect(JSON.parse(JSON.stringify(message))).toEqual(message);
	});
});

describe('usage', () => {
	test('adds every counter, cache tokens included', () => {
		const a = {
			inputTokens: 10,
			outputTokens: 5,
			cacheReadTokens: 100,
			cacheWriteTokens: 20,
		};
		const b = {
			inputTokens: 1,
			outputTokens: 2,
			cacheReadTokens: 3,
			cacheWriteTokens: 4,
		};
		expect(addUsage(a, b)).toEqual({
			inputTokens: 11,
			outputTokens: 7,
			cacheReadTokens: 103,
			cacheWriteTokens: 24,
		});
		expect(addUsage(emptyUsage(), a)).toEqual(a);
	});
});

describe('AiError', () => {
	test('carries its code, issues and cause', () => {
		const cause = new Error('inner');
		const error = new AiError('INVALID_TOOL_INPUT', 'bad', {
			cause,
			issues: [{ path: 'a', message: 'm' }],
		});
		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe('AiError');
		expect(error.code).toBe('INVALID_TOOL_INPUT');
		expect(error.cause).toBe(cause);
		expect(error.issues).toEqual([{ path: 'a', message: 'm' }]);
		expect(new AiError('ABORTED', 'x').issues).toEqual([]);
	});

	test('errorResult carries the error details, and omits empty ones', () => {
		const withDetails = errorResult(
			{ id: 'c', name: 'n' },
			new AiError('TOOL_FAILED', 'x', {
				details: [{ code: 'auth.errors.forbidden', params: { n: 2 } }],
			}),
		);
		expect(withDetails).toMatchObject({
			error: {
				code: 'TOOL_FAILED',
				details: [{ code: 'auth.errors.forbidden', params: { n: 2 } }],
			},
		});
		const without = errorResult(
			{ id: 'c', name: 'n' },
			new AiError('TOOL_FAILED', 'x'),
		);
		if (!without.isError) throw new Error('expected an error');
		expect('details' in without.error).toBe(false);
	});

	test('errorResult omits empty issues', () => {
		expect(
			errorResult({ id: 'c', name: 'n' }, new AiError('TOOL_FAILED', 'x')),
		).toEqual({
			type: 'tool-result',
			callId: 'c',
			name: 'n',
			isError: true,
			error: { code: 'TOOL_FAILED', message: 'x' },
		});
	});
});
