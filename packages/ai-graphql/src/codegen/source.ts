import { existsSync, readFileSync, statSync } from 'node:fs';
import { type DefinitionNode, type DocumentNode, Kind, parse } from 'graphql';

export interface SourceFile {
	document?: DocumentNode | undefined;
	rawSDL?: string | undefined;
	location?: string | undefined;
}

export interface Parsed {
	definitions: readonly DefinitionNode[];
	/** The text the definitions were parsed from; its `loc` offsets index it. */
	body: string | undefined;
}

function tryParse(text: string): DocumentNode | undefined {
	try {
		return parse(text);
	} catch {
		return undefined;
	}
}

function operationNames(definitions: readonly DefinitionNode[]): string {
	return definitions
		.flatMap((d) =>
			d.kind === Kind.OPERATION_DEFINITION ? [d.name?.value ?? ''] : [],
		)
		.sort()
		.join(',');
}

function readDisk(location: string | undefined): string | undefined {
	try {
		if (location && existsSync(location) && statSync(location).isFile()) {
			return readFileSync(location, 'utf8');
		}
	} catch {
		// unreadable: no comments from disk
	}
	return undefined;
}

/**
 * The definitions of one document file with the text they come from.
 * graphql-codegen hands `rawSDL` printed (without comments) and parses
 * without locations, so the comments are read from the file on disk when
 * `rawSDL` has none and the file holds the same operations. Fallbacks:
 * `rawSDL`, then the document's own location source.
 */
export function parseSource(file: SourceFile): Parsed {
	const document = file.document;
	const raw = file.rawSDL ? tryParse(file.rawSDL) : undefined;
	const text = readDisk(file.location);
	const disk = text === undefined ? undefined : tryParse(text);
	const expected = operationNames(
		document?.definitions ?? raw?.definitions ?? [],
	);
	if (
		disk &&
		text !== undefined &&
		operationNames(disk.definitions) === expected
	) {
		return { definitions: disk.definitions, body: text };
	}
	if (raw) return { definitions: raw.definitions, body: file.rawSDL };
	return {
		definitions: document?.definitions ?? [],
		body: document?.loc?.source.body,
	};
}
