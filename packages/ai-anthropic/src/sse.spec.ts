import { describe, expect, test } from 'bun:test';
import { parseSse, type SseEvent } from './sse';
import { bytesStream, chunked } from './test-helpers';

async function collect(chunks: Uint8Array[]): Promise<SseEvent[]> {
	const out: SseEvent[] = [];
	for await (const e of parseSse(bytesStream(chunks))) out.push(e);
	return out;
}

const text =
	'event: a\ndata: {"x":"é"}\n\n: comment\n\nevent: b\ndata: 1\ndata: 2\n\ndata: bare\n\n';
const expected: SseEvent[] = [
	{ event: 'a', data: '{"x":"é"}' },
	{ event: 'b', data: '1\n2' },
	{ event: 'message', data: 'bare' },
];

describe('parseSse', () => {
	test('parses events, comments and multi-line data', async () => {
		expect(await collect(chunked(text, 1000))).toEqual(expected);
	});

	test('survives a split at every byte offset, even inside a UTF-8 character', async () => {
		const bytes = new TextEncoder().encode(text);
		for (let i = 1; i < bytes.length; i++)
			expect(await collect([bytes.slice(0, i), bytes.slice(i)])).toEqual(
				expected,
			);
	});

	test('survives one byte per chunk', async () => {
		expect(await collect(chunked(text, 1))).toEqual(expected);
	});

	test('accepts CRLF line ends, split anywhere', async () => {
		const crlf = text.replaceAll('\n', '\r\n');
		const bytes = new TextEncoder().encode(crlf);
		for (let i = 1; i < bytes.length; i++)
			expect(await collect([bytes.slice(0, i), bytes.slice(i)])).toEqual(
				expected,
			);
	});

	test('yields a last event that has no closing blank line', async () => {
		expect(await collect(chunked('event: z\ndata: end', 4))).toEqual([
			{ event: 'z', data: 'end' },
		]);
	});
});
