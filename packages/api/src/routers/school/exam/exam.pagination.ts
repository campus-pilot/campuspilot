import {
  createNextPageCursor,
  createPaginatedResult,
  resolvePaginationInput,
} from "../../../paginations";

export const route = (summary: string, description: string) => ({
  summary,
  description,
  tags: ["School", "Exams"],
});
export function pageResult<T>(
  items: T[],
  totalItems: number,
  input: { limit: number; page?: number; cursor?: string },
) {
  const { currentPage, pageSize } = resolvePaginationInput(input);
  const totalPages = Math.ceil(totalItems / pageSize);
  return createPaginatedResult({
    items,
    totalItems,
    currentPage,
    pageSize,
    totalPages,
    nextCursor: createNextPageCursor(currentPage, totalPages),
  });
}
