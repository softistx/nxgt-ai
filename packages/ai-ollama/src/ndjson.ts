import { OllamaError } from './errors';

function parseLine(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch (cause) {
		throw new OllamaError({
			kind: 'protocol',
			code: 'MODEL_ERROR',
			message: `Ollama sent a line that is not JSON: ${line.slice(0, 80)}`,
			cause,
		});
	}
}

/**
 * Parses an NDJSON byte stream into one value per non-blank line. Chunks may
 * split anywhere, even inside a UTF-8 character; a last line with no newline
 * after it is still yielded when the stream ends.
 */
export async function* parseNdjson(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<unknown> {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = '';
	const stop = () => void reader.cancel().catch(() => {});
	signal?.addEventListener('abort', stop, { once: true });
	try {
		for (;;) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			let end = buffer.indexOf('\n');
			while (end !== -1) {
				const line = buffer.slice(0, end).trim();
				buffer = buffer.slice(end + 1);
				if (line !== '') yield parseLine(line);
				end = buffer.indexOf('\n');
			}
			if (done) break;
		}
		const last = buffer.trim();
		if (last !== '') yield parseLine(last);
	} finally {
		signal?.removeEventListener('abort', stop);
		stop();
	}
}
