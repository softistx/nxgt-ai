/** Options of the plugin, under `config` in `codegen.ts`. */
export interface OperationsManifestConfig {
	/** Name of the exported array; default `operations`. */
	exportName?: string;
	/**
	 * Where the `z<Op>Variables` schemas are imported from, written as given
	 * (add `.js` under `nodenext`); default `./zod`, the file
	 * `@nxgt/graphql-codegen-zod` writes beside the manifest.
	 */
	zodImport?: string;
	/** Where `GraphqlOperation` is imported from; default `@nxgt/ai-graphql`. */
	typesImport?: string;
	/** Tool name by GraphQL operation name; default: the operation name. */
	names?: Record<string, string>;
	/**
	 * The next five mirror `@nxgt/graphql-codegen-zod`'s options of the same
	 * name; set both plugins alike so the imported names exist.
	 */
	schemaPrefix?: string;
	typesPrefix?: string;
	typesSuffix?: string;
	dedupeOperationSuffix?: boolean;
	omitOperationSuffix?: boolean;
	/** `string` (`keep`, `change-case-all#<case>`), a function, or `{ typeNames, transformUnderscore }`. */
	namingConvention?: NamingConvention;
}

export type NamingConvention =
	| string
	| ((name: string) => string)
	| {
			typeNames?: string | ((name: string) => string);
			transformUnderscore?: boolean;
	  };

export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const IDENTIFIER_PART = /^[A-Za-z0-9_$]*$/;

export function fail(message: string): never {
	throw new Error(`@nxgt/ai-graphql/codegen: ${message}`);
}

/** Throws a clear error for an option that cannot work. */
export function checkConfig(config: OperationsManifestConfig): void {
	const exportName = config.exportName ?? 'operations';
	if (!IDENTIFIER.test(exportName)) {
		fail(`exportName "${exportName}" is not a valid identifier.`);
	}
	for (const key of ['schemaPrefix', 'typesPrefix', 'typesSuffix'] as const) {
		const value = config[key];
		if (value !== undefined && !IDENTIFIER_PART.test(value)) {
			fail(`${key} "${value}" must be letters, digits, "_" and "$" only.`);
		}
	}
	for (const key of ['zodImport', 'typesImport'] as const) {
		const value = config[key];
		if (value !== undefined && (typeof value !== 'string' || value === '')) {
			fail(`${key} must be a non-empty string.`);
		}
	}
}
