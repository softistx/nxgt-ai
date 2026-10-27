import { describe, expect, test } from 'bun:test';
import { realSleep } from './sleep';

/** A signal that counts its abort listeners. */
function counted() {
	const controller = new AbortController();
	const live = new Set<unknown>();
	const add = controller.signal.addEventListener.bind(controller.signal);
	const remove = controller.signal.removeEventListener.bind(controller.signal);
	controller.signal.addEventListener = ((type: string, fn: never, o: never) => {
		live.add(fn);
		add(type, fn, o);
	}) as typeof add;
	controller.signal.removeEventListener = ((
		type: string,
		fn: never,
		o: never,
	) => {
		live.delete(fn);
		remove(type, fn, o);
	}) as typeof remove;
	return { controller, live };
}

describe('realSleep', () => {
	test('removes its abort listener when the timer fires', async () => {
		const { controller, live } = counted();
		await realSleep(1, controller.signal);
		expect(live.size).toBe(0);
	});

	test('rejects with the reason when the signal aborts', async () => {
		const { controller } = counted();
		const wait = realSleep(5000, controller.signal);
		controller.abort(new Error('stop'));
		await expect(wait).rejects.toThrow('stop');
	});

	test('rejects at once on an already aborted signal', async () => {
		const wait = realSleep(5000, AbortSignal.abort(new Error('done')));
		await expect(wait).rejects.toThrow('done');
	});
});
