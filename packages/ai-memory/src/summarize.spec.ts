import { describe, expect, it } from 'bun:test';
import { fakeModel } from '@nxgt/ai-testing';
import { summarizeWith } from './index';

describe('summarizeWith', () => {
	it('sends a transcript with the options and returns the trimmed text', async () => {
		const model = fakeModel([{ text: '  Short.  ' }]);
		const signal = new AbortController().signal;
		const out = await summarizeWith(model, {
			system: 'Be brief',
			maxTokens: 50,
			signal,
		})([
			{ role: 'user', parts: [{ type: 'text', text: 'hello' }] },
			{
				role: 'assistant',
				parts: [{ type: 'tool-call', id: 'a', name: 'find', input: {} }],
			},
			{
				role: 'tool',
				parts: [
					{
						type: 'tool-result',
						callId: 'a',
						name: 'find',
						isError: false,
						output: 7,
					},
				],
			},
		]);
		expect(out).toBe('Short.');
		const req = model.requests[0];
		expect(req?.system?.[0]?.text).toBe('Be brief');
		expect(req?.maxTokens).toBe(50);
		const sent = JSON.stringify(req?.messages);
		expect(sent).toContain('user: hello');
		expect(sent).toContain('[called find]');
		expect(sent).toContain('[result of find: 7]');
	});
});
