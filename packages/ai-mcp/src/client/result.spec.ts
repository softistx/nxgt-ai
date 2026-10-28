import { describe, expect, it } from 'bun:test';
import { serverCodeOf, toContent } from './result';

describe('toContent', () => {
	it('passes a text resource on as text', () => {
		expect(
			toContent([
				{ type: 'resource', resource: { uri: 'a:b', text: 'hello' } },
			]),
		).toEqual([{ type: 'text', text: 'hello' }]);
	});

	it('names a blob resource instead of forwarding it', () => {
		const out = toContent([
			{
				type: 'resource',
				resource: { uri: 'a:b', blob: 'QUJD', mimeType: 'application/pdf' },
			},
		]);
		expect(out).toEqual([
			{ type: 'omitted', kind: 'resource', mimeType: 'application/pdf' },
		]);
		expect(JSON.stringify(out)).not.toContain('QUJD');
	});

	it('names a blob resource without a mime type', () => {
		expect(
			toContent([{ type: 'resource', resource: { uri: 'a:b', blob: 'QUJD' } }]),
		).toEqual([{ type: 'omitted', kind: 'resource' }]);
	});

	it('keeps a resource_link as a link, with its name when it has one', () => {
		expect(
			toContent([
				{ type: 'resource_link', uri: 'file:///a', name: 'a' },
				{ type: 'resource_link', uri: 'file:///b' },
			]),
		).toEqual([
			{ type: 'link', uri: 'file:///a', name: 'a' },
			{ type: 'link', uri: 'file:///b' },
		]);
	});
});

describe('serverCodeOf', () => {
	const text = (t: string) => [{ type: 'text', text: t }];

	it('reads a bare UPPER_SNAKE code', () => {
		expect(serverCodeOf(text('{"code":"INVALID_TOOL_INPUT"}'))).toBe(
			'INVALID_TOOL_INPUT',
		);
	});

	it('reads nothing else', () => {
		for (const t of [
			'{"code":"lower"}',
			'{"code":"A","message":"secret"}',
			`{"code":"${'A'.repeat(41)}"}`,
			'plain secret',
			'{"code":1}',
			'[]',
		]) {
			expect(serverCodeOf(text(t))).toBeUndefined();
		}
		expect(serverCodeOf([])).toBeUndefined();
		expect(serverCodeOf(undefined)).toBeUndefined();
	});
});
