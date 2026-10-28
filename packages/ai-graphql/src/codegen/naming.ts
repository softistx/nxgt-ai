// Temporary, until @nxgt/graphql-codegen-zod#126 (export the naming)
import * as changeCase from 'change-case';
import {
	fail,
	type NamingConvention,
	type OperationsManifestConfig,
} from './config';

// Mirrors the naming of @nxgt/graphql-codegen-zod 0.3.x (its `Naming` class is
// not exported), so the manifest imports the names that plugin writes.

type Convert = (name: string) => string;

const upperFirst: Convert = (n) => n.charAt(0).toUpperCase() + n.slice(1);
const lowerFirst: Convert = (n) => n.charAt(0).toLowerCase() + n.slice(1);

const common = {
	camelCase: changeCase.camelCase,
	capitalCase: changeCase.capitalCase,
	constantCase: changeCase.constantCase,
	dotCase: changeCase.dotCase,
	noCase: changeCase.noCase,
	pascalCase: changeCase.pascalCase,
	pathCase: changeCase.pathCase,
	sentenceCase: changeCase.sentenceCase,
	snakeCase: changeCase.snakeCase,
};

const cases: Record<string, Record<string, Convert>> = {
	'change-case-all': {
		...common,
		headerCase: changeCase.trainCase,
		paramCase: changeCase.kebabCase,
		lowerCase: (n) => n.toLowerCase(),
		upperCase: (n) => n.toUpperCase(),
		lowerCaseFirst: lowerFirst,
		upperCaseFirst: upperFirst,
	},
	'change-case': {
		...common,
		kebabCase: changeCase.kebabCase,
		pascalSnakeCase: changeCase.pascalSnakeCase,
		trainCase: changeCase.trainCase,
	},
};

function caseNamed(spec: string): Convert {
	const [module = '', name = ''] = spec.split('#');
	const fn = cases[module]?.[name];
	if (fn) return fn;
	return fail(
		`namingConvention "${spec}" is not one this plugin reads. Use 'keep', a function, or 'change-case-all#<case>'.`,
	);
}

const byPart =
	(fn: Convert, whole: boolean): Convert =>
	(name) =>
		whole ? fn(name) : name.split('_').map(fn).join('_');

function converter(convention: NamingConvention | undefined): Convert {
	if (convention === undefined) return byPart(changeCase.pascalCase, false);
	if (convention === 'keep') return (n) => n;
	if (typeof convention === 'function') return byPart(convention, false);
	if (typeof convention === 'string')
		return byPart(caseNamed(convention), false);
	const { typeNames, transformUnderscore } = convention;
	if (typeNames === 'keep') return (n) => n;
	if (typeNames === undefined) {
		return byPart(changeCase.pascalCase, transformUnderscore ?? false);
	}
	const fn = typeof typeNames === 'function' ? typeNames : caseNamed(typeNames);
	return byPart(fn, true);
}

/** The name of the `z<Op>Variables` schema `@nxgt/graphql-codegen-zod` writes. */
export function variablesSchemaName(
	config: OperationsManifestConfig,
): (operation: string, kind: 'query' | 'mutation') => string {
	const convert = converter(config.namingConvention);
	return (operation, kind) => {
		const type = changeCase.pascalCase(kind);
		const suffix =
			config.omitOperationSuffix ||
			(config.dedupeOperationSuffix &&
				operation.toLowerCase().endsWith(type.toLowerCase()))
				? ''
				: type;
		const typeName = `${config.typesPrefix ?? ''}${convert(`${operation}${suffix}Variables`)}${config.typesSuffix ?? ''}`;
		return `${config.schemaPrefix ?? 'z'}${typeName}`;
	};
}
