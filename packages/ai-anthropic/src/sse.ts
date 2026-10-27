/** One server-sent event: its `event:` name and joined `data:` lines. */
export interface SseEvent {
	event: string;
	data: string;
}

function parseBlock(block: string): SseEvent | undefined {
	let event = 'message';
	const data: string[] = [];
	for (const line of block.split('\n')) {
		if (line === '' || line.startsWith(':')) continue;
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'event') event = value;
		else if (field === 'data') data.push(value);
	}
	return data.length === 0 ? undefined : { event, data: data.join('\n') };
}

/**
 * Parses an SSE byte stream. Chunks may split anywhere, even inside a UTF-8
 * character or a `\r\n`; an event ends at a blank line. A trailing event with
 * no blank line after it is still yielded when the stream ends.
 */
export async function* parseSse(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
	const decoder = new TextDecoder();
	const reader = body.getReader();
	let buffer = '';
	try {
		for (;;) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			buffer = buffer.replace(/\r\n?/g, (m, i, s) =>
				m === '\r' && i === s.length - 1 ? m : '\n',
			);
			let end = buffer.indexOf('\n\n');
			while (end !== -1) {
				const event = parseBlock(buffer.slice(0, end));
				buffer = buffer.slice(end + 2);
				if (event) yield event;
				end = buffer.indexOf('\n\n');
			}
			if (done) break;
		}
		const last = parseBlock(buffer.replace(/\r/g, ''));
		if (last) yield last;
	} finally {
		reader.cancel().catch(() => {});
	}
}
