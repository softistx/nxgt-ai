/**
 * Verbatim shape `@nxgt/graphql-codegen-zod` 0.4 writes for list variables and
 * list input fields: a single-value coercion (`z.custom`) piped into the array.
 */
import { z } from 'zod';

const list = <T extends z.ZodType>(item: T) =>
	z
		.union([
			z.array(z.custom<unknown>()),
			z
				.custom<unknown>((value) => value != null && !Array.isArray(value))
				.transform((value): unknown[] => [value]),
		])
		.pipe(z.array(item));

export const zTagFilter = z.strictObject({
	tags: list(z.string()).nullish(),
	n: z.int32().nullish(),
});

export const zThingsQueryVariables = z.object({
	ids: list(z.string()).nullish(),
});

export const zTagMutationVariables = z.object({
	get input() {
		return zTagFilter;
	},
});

export const zMatrixVariables = z.object({
	rows: list(list(z.string())),
});

export const zDateList = list(z.date());
