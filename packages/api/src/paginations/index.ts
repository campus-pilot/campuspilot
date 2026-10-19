import { z } from "zod";

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 20;

const paginationInputShape = {
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/, "Cursor must identify a positive page.")
    .refine(
      (value) => Number.isSafeInteger(Number(value)),
      "Cursor must identify a safe positive page.",
    )
    .optional(),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
};

export function createListInputSchema<const TShape extends z.ZodRawShape>(shape: TShape) {
  return z
    .object({ ...shape, ...paginationInputShape })
    .refine(
      (value) => {
        const { cursor, page } = value as { cursor?: string; page?: number };
        return cursor === undefined || page === undefined;
      },
      {
        message: "Pass either cursor or page, not both.",
        path: ["cursor"],
      },
    );
}

export const paginationMetadataSchema = z.object({
  nextCursor: z.string().nullable(),
  currentPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  pageSize: z.number().int().positive().max(MAX_LIST_LIMIT),
});

export function createPaginatedOutputSchema<TItemSchema extends z.ZodType>(
  itemSchema: TItemSchema,
) {
  return z.object({
    items: z.array(itemSchema),
    pagination: paginationMetadataSchema,
  });
}

type PaginationInput = {
  cursor?: string;
  page?: number;
  limit: number;
};

export function resolvePaginationInput(input: PaginationInput) {
  const currentPage = input.cursor ? Number(input.cursor) : (input.page ?? 1);

  return {
    currentPage,
    pageSize: input.limit,
    offset: (currentPage - 1) * input.limit,
  };
}

type PaginatedResultInput<TItem> = {
  items: TItem[];
  nextCursor: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
};

export function createPaginatedResult<TItem>({
  items,
  nextCursor,
  currentPage,
  totalPages,
  totalItems,
  pageSize,
}: PaginatedResultInput<TItem>) {
  return {
    items,
    pagination: {
      nextCursor,
      currentPage,
      totalPages,
      totalItems,
      pageSize,
    },
  };
}

export function createNextPageCursor(currentPage: number, totalPages: number) {
  return currentPage < totalPages ? String(currentPage + 1) : null;
}
