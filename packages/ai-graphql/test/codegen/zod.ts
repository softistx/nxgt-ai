import { z } from 'zod';

// Stands in for the file @nxgt/graphql-codegen-zod writes.
export const zGetBookQueryVariables = z.object({
	id: z.string().describe('The book id'),
});
export const zListBooksQueryVariables = z.object({
	limit: z.number().int().nullish(),
});
export const zRenewLoanMutationVariables = z.object({
	bookId: z.string(),
});
