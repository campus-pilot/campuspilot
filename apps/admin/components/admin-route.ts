import type { ReactNode } from 'react';
import type { AppShellBreadcrumb } from '@campuspilot/components/app-shell';

export type AdminPageDescriptor<
  TParams extends Record<string, string> = Record<string, never>,
> = {
  matches: (pathname: string) => boolean;
  breadcrumbs: (params: TParams) => AppShellBreadcrumb[];
  actions?: (params: TParams) => ReactNode;
};

/**
 * Defines the pathname matcher and navbar content owned by an admin page.
 * Keeping this helper preserves the page parameter type for each callback.
 */
export function defineAdminPage<TParams extends Record<string, string>>(
  descriptor: AdminPageDescriptor<TParams>,
) {
  return descriptor;
}

/**
 * Resolves navbar actions with page-over-layout precedence.
 * A page can return `null` to hide inherited actions; when the page does not
 * define actions, the layout actions are used, and an absent layout renders none.
 */
export function resolveAdminPageActions<TParams extends Record<string, string>>(
  page: AdminPageDescriptor<TParams> | undefined,
  params: TParams,
  layoutActions?: ReactNode,
) {
  return page?.actions ? page.actions(params) : layoutActions;
}
