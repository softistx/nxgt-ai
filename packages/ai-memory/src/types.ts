import type {
	Message,
	ProposedAction,
	ProposedActionStatus,
	ToolResultPart,
} from '@nxgt/ai-core';

/** A rolling summary of the start of a thread. */
export interface ThreadSummary {
	text: string;
	/** The last message the summary covers. */
	throughMessageId: string;
	/** Estimated tokens of `text`. */
	tokens: number;
	/** Epoch milliseconds. */
	createdAt: number;
}

export interface Thread {
	id: string;
	ownerId: string;
	title?: string;
	meta?: Record<string, unknown>;
	messageCount: number;
	summary?: ThreadSummary;
	/** Epoch milliseconds. */
	createdAt: number;
	updatedAt: number;
}

export interface StoredMessage {
	id: string;
	threadId: string;
	/** 1-based position in the thread. */
	seq: number;
	message: Message;
	createdAt: number;
}

export interface CreateThreadInput {
	ownerId: string;
	title?: string;
	meta?: Record<string, unknown>;
}

export interface Page {
	/** At most this many threads; default 20, capped at 100. */
	limit?: number;
	/** The `nextCursor` of the previous page. */
	cursor?: string;
}

export interface ThreadPage {
	/** Newest thread first. */
	items: Thread[];
	/** Absent on the last page. */
	nextCursor?: string;
}

export interface LoadOptions {
	/** Only the messages after the summary's `throughMessageId`, when there is one. */
	sinceSummary: boolean;
}

export interface LoadedThread {
	thread: Thread;
	summary?: ThreadSummary;
	messages: StoredMessage[];
}

export interface SummaryInput {
	text: string;
	throughMessageId: string;
	tokens: number;
}

/** What may change on a pending action; `status` is where it goes next. */
export interface ActionPatch {
	status: Exclude<ProposedActionStatus, 'pending'>;
	result?: ToolResultPart;
}

/**
 * Where conversations live. Every call carries the `ownerId` and sees only
 * that owner's data: another owner's thread reads as absent, never as
 * forbidden. Reads of an absent thread return `undefined`; writes to one raise
 * `MemoryError('THREAD_NOT_FOUND')`.
 */
export interface MemoryStore {
	createThread(input: CreateThreadInput): Promise<Thread>;
	getThread(id: string, ownerId: string): Promise<Thread | undefined>;
	listThreads(ownerId: string, page?: Page): Promise<ThreadPage>;
	/** Adds messages at the end, validated; returns them stored. */
	append(
		threadId: string,
		ownerId: string,
		messages: readonly Message[],
	): Promise<StoredMessage[]>;
	load(
		threadId: string,
		ownerId: string,
		options: LoadOptions,
	): Promise<LoadedThread | undefined>;
	setSummary(
		threadId: string,
		ownerId: string,
		summary: SummaryInput,
	): Promise<ThreadSummary>;
	/** A proposed action recorded by an appended `proposed-action` part. */
	findAction(
		actionId: string,
		ownerId: string,
	): Promise<ProposedAction | undefined>;
	/**
	 * Compare-and-set: applies the patch only while the action is `pending`
	 * and returns it; returns `undefined` when it is absent or no longer
	 * pending, so of two concurrent confirmations only one wins.
	 */
	updateAction(
		actionId: string,
		ownerId: string,
		patch: ActionPatch,
	): Promise<ProposedAction | undefined>;
	/** Removes the thread, its messages and its actions; false when absent. */
	deleteThread(id: string, ownerId: string): Promise<boolean>;
}
