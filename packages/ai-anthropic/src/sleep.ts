/** Waits `ms`, or rejects with the signal's reason when it aborts first. */
export const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		if (signal.aborted) onAbort();
		else signal.addEventListener('abort', onAbort, { once: true });
	});
