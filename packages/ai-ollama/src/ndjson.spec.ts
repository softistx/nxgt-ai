import { describe, expect, test } from 'bun:test';
import { OllamaError } from './errors';
import { parseNdjson } from './ndjson';
import { bytesStream, chunked } from './test-helpers';

const collect = async (chunks: Uint8Array[]) => {
	const out: unknown[] = [];
	for await (const v of parseNdjson(bytesStream(chunks))) out.push(v);
	return out;
};

describe('parseNdjson', () => {
	const text = '{"a":"é🌍"}\n\n{"b":2}\r\n{"c":3}';
	const expected = [{ a: 'é🌍' }, { b: 2 }, { c: 3 }];

	test('splits lines, skips blanks, yields a last line without newline', async () => {
		expect(await collect(chunked(text, 1000))).toEqual(expected);
	});

	test('gives the same values at every byte boundary', async () => {
		const bytes = new TextEncoder().encode(text);
		for (let i = 1; i < bytes.length; i++)
			expect(await collect([bytes.slice(0, i), bytes.slice(i)])).toEqual(
				expected,
			);
		expect(await collect(chunked(text, 1))).toEqual(expected);
	});

	test('rejects a line that is not JSON', async () => {
		const failure = collect(chunked('{"a":1}\nnope\n', 8));
		expect(failure).rejects.toMatchObject({ kind: 'protocol' });
		expect(failure).rejects.toBeInstanceOf(OllamaError);
	});
});
