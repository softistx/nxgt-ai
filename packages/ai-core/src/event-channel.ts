/** An unbounded queue read as an async iterable by one consumer. */
export interface EventChannel<E> {
	push(event: E): void;
	close(): void;
	[Symbol.asyncIterator](): AsyncIterator<E>;
}

export function createChannel<E>(): EventChannel<E> {
	const buffer: E[] = [];
	let closed = false;
	let wake: (() => void) | undefined;
	const notify = () => {
		wake?.();
		wake = undefined;
	};
	return {
		push(event) {
			if (closed) return;
			buffer.push(event);
			notify();
		},
		close() {
			closed = true;
			notify();
		},
		async *[Symbol.asyncIterator]() {
			for (;;) {
				const next = buffer.shift();
				if (next !== undefined) yield next;
				else if (closed) return;
				else await new Promise<void>((resolve) => (wake = resolve));
			}
		},
	};
}
