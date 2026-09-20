import type { ReactNode } from 'react';
import type { AppShellBreadcrumb } from '@campuspilot/components/app-shell';

export type ManagementPageDescriptor<
  TParams extends Record<string, string> = Record<string, never>,
> = {
  matches: (pathname: string) => boolean;
  breadcrumbs: (params: TParams) => AppShellBreadcrumb[];
  actions?: (params: TParams) => ReactNode;
};

/** Preserves each route's parameter type while keeping shell metadata page-owned. */
export function defineManagementPage<TParams extends Record<string, string>>(
  descriptor: ManagementPageDescriptor<TParams>,
) {
  return descriptor;
}

/** Page actions override layout actions, including an explicit null result. */
export function resolveManagementPageActions<
  TParams extends Record<string, string>,
>(
  page: ManagementPageDescriptor<TParams> | undefined,
  params: TParams,
  layoutActions?: ReactNode,
) {
  return page?.actions ? page.actions(params) : layoutActions;
}

