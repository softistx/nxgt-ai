import { describe, expect, test } from 'bun:test';
import { estimateTokens } from './estimate-tokens';

describe('estimateTokens', () => {
	test('text is chars / 4 rounded up', () => {
		expect(estimateTokens('')).toBe(0);
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('abcde')).toBe(2);
		expect(estimateTokens('a'.repeat(4000))).toBe(1000);
	});

	test('messages count every part', () => {
		const n = estimateTokens([
			{ role: 'user', parts: [{ type: 'text', text: 'a'.repeat(40) }] },
			{
				role: 'assistant',
				parts: [
					{ type: 'thinking', text: 'b'.repeat(40) },
					{ type: 'tool-call', id: '1', name: 'ab', input: { v: 'x' } },
				],
			},
			{
				role: 'tool',
				parts: [
					{
						type: 'tool-result',
						callId: '1',
						name: 'ab',
						isError: false,
						output: 'ok',
					},
					{
						type: 'tool-result',
						callId: '2',
						name: 'ab',
						isError: true,
						error: { code: 'TOOL_FAILED', message: 'x'.repeat(40) },
					},
				],
			},
		]);
		// 40 + 40 + 11 + 4 + 40 = 135 characters
		expect(n).toBe(34);
	});

	test('an empty conversation costs nothing', () => {
		expect(estimateTokens([])).toBe(0);
	});
});
