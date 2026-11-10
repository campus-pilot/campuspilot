import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * A stand-in for `@/lib/orpc` in component tests. Each procedure answers
 * from `handlers[name](input)`; a handler that throws makes the query fail
 * (an object with `code` mimics an oRPC error). Tests never reach a server.
 */
export type Handlers = Record<string, (input: unknown) => unknown>;

export const handlers: Handlers = {};

function procedure(name: string) {
  const call = async (input: unknown) => {
    const handler = handlers[name];
    if (!handler) throw new Error(`No mock handler for ${name}`);
    return handler(input);
  };
  return {
    queryOptions: (options: { input?: unknown } = {}) => ({
      queryKey: [name, options.input ?? null],
      queryFn: () => call(options.input),
    }),
    infiniteOptions: (options: {
      input: (pageParam: unknown) => unknown;
      initialPageParam: unknown;
      getNextPageParam: (page: never) => unknown;
    }) => ({
      queryKey: [name, 'infinite'],
      queryFn: ({ pageParam }: { pageParam: unknown }) => call(options.input(pageParam)),
      initialPageParam: options.initialPageParam,
      getNextPageParam: options.getNextPageParam,
    }),
  };
}

export const orpcMock = new Proxy({} as Record<string, ReturnType<typeof procedure>>, {
  get: (_target, name: string) => procedure(name),
});

export function resetHandlers(next: Handlers) {
  for (const key of Object.keys(handlers)) delete handlers[key];
  Object.assign(handlers, next);
}

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  // The client is returned so a test can refetch (a return to the tab) after changing a handler.
  return { ...render(ui, { wrapper }), queryClient };
}

export const page = <T,>(items: T[]) => ({
  items,
  pagination: { nextCursor: null, currentPage: 1, totalPages: items.length ? 1 : 0, totalItems: items.length, pageSize: 20 },
});
