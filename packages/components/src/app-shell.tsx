'use client';

import {
  Fragment,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  BookOpen,
  CircleUserRound,
  LogOut,
  MoreHorizontal,
  Moon,
  Sun,
} from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@campuspilot/ui/components/avatar';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@campuspilot/ui/components/breadcrumb';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { Separator } from '@campuspilot/ui/components/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from '@campuspilot/ui/components/sidebar';
import { useTheme } from './theme-provider';

export type AppShellIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type AppShellNavigationItem = {
  type: 'item';
  id: string;
  label: string;
  href: string;
  icon: AppShellIcon;
  match?: 'exact' | 'prefix';
  items?: AppShellNavigationItem[];
};

export type AppShellNavigationGroup = {
  type: 'group';
  id: string;
  label: string;
  items: AppShellNavigationItem[];
};

export type AppShellNavigationEntry =
  | AppShellNavigationGroup
  | AppShellNavigationItem;

export type AppShellBreadcrumb = {
  id: string;
  label: ReactNode;
  icon?: AppShellIcon;
  href?: string;
};

export type AppShellUser = {
  name: string;
  secondaryLabel: string;
  avatarUrl?: string | null;
};

export type AppShellLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  ariaCurrent?: 'page';
};

type AppShellProps = {
  children: ReactNode;
  currentPath: string;
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  sidebarHeader: ReactNode;
  search: ReactNode;
  user: AppShellUser;
  docsHref?: string;
  navbarActions?: ReactNode;
  onManageAccount?: () => void;
  onLogout?: () => void | Promise<void>;
  renderLink?: (props: AppShellLinkProps) => ReactNode;
};

function pathMatches(item: AppShellNavigationItem, currentPath: string) {
  if (item.match === 'exact' || item.href === '/') {
    return currentPath === item.href;
  }

  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function AppLink({
  href,
  children,
  className,
  ariaCurrent,
  renderLink,
}: AppShellLinkProps & Pick<AppShellProps, 'renderLink'>) {
  return renderLink ? (
    renderLink({ href, children, className, ariaCurrent })
  ) : (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

function NavigationItem({
  item,
  currentPath,
  renderLink,
}: {
  item: AppShellNavigationItem;
  currentPath: string;
  renderLink?: AppShellProps['renderLink'];
}) {
  const hasActiveChild = item.items?.some((child) =>
    pathMatches(child, currentPath),
  );
  const isDirectlyActive = currentPath === item.href;
  const isActive = pathMatches(item, currentPath) || Boolean(hasActiveChild);
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className="rounded-lg"
      >
        <AppLink
          href={item.href}
          ariaCurrent={isDirectlyActive ? 'page' : undefined}
          renderLink={renderLink}
        >
          <Icon />
          <span>{item.label}</span>
        </AppLink>
      </SidebarMenuButton>
      {item.items?.length ? (
        <SidebarMenuSub>
          {item.items.map((child) => {
            const ChildIcon = child.icon;
            const isChildDirectlyActive = currentPath === child.href;
            return (
              <SidebarMenuSubItem key={child.id}>
                <SidebarMenuSubButton
                  asChild
                  isActive={pathMatches(child, currentPath)}
                  className="rounded-lg"
                >
                  <AppLink
                    href={child.href}
                    ariaCurrent={isChildDirectlyActive ? 'page' : undefined}
                    renderLink={renderLink}
                  >
                    <ChildIcon />
                    <span>{child.label}</span>
                  </AppLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

function UserMenu({
  user,
  onManageAccount,
  onLogout,
}: Pick<AppShellProps, 'user' | 'onManageAccount' | 'onLogout'>) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start rounded-lg px-2 py-1.5"
        >
          <Avatar size="sm">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate font-medium">{user.name}</span>
            <span className="block truncate text-[10px] font-normal text-muted-foreground">
              {user.secondaryLabel}
            </span>
          </span>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60 rounded-xl">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate font-medium text-foreground">
              {user.name}
            </span>
            <span className="block truncate font-normal">
              {user.secondaryLabel}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManageAccount}>
          <CircleUserRound />
          Manage account
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme('light')}>
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              System
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onLogout}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  children,
  currentPath,
  navigation,
  breadcrumbs,
  sidebarHeader,
  search,
  user,
  docsHref = '/docs',
  navbarActions,
  onManageAccount,
  onLogout,
  renderLink,
}: AppShellProps) {
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '16.5rem' } as React.CSSProperties}
    >
      <Sidebar variant="inset" className="p-2 pr-0">
        <SidebarHeader className="p-3">{sidebarHeader}</SidebarHeader>
        <SidebarContent>
          {navigation.map((entry) =>
            entry.type === 'group' ? (
              <SidebarGroup key={entry.id}>
                <SidebarGroupLabel className="text-[10px] uppercase tracking-widest">
                  {entry.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {entry.items.map((item) => (
                      <NavigationItem
                        key={item.id}
                        item={item}
                        currentPath={currentPath}
                        renderLink={renderLink}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : (
              <SidebarGroup
                key={entry.id}
                className="mt-8 group-data-[collapsible=icon]:mt-0"
              >
                <SidebarGroupContent>
                  <SidebarMenu>
                    <NavigationItem
                      item={entry}
                      currentPath={currentPath}
                      renderLink={renderLink}
                    />
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ),
          )}
        </SidebarContent>
        <SidebarFooter className="gap-1 p-3">
          {search}
          <Button
            asChild
            variant="ghost"
            className="justify-start rounded-lg px-2"
          >
            <AppLink href={docsHref} renderLink={renderLink}>
              <BookOpen />
              Docs
            </AppLink>
          </Button>
          <Separator className="my-2" />
          <UserMenu
            user={user}
            onManageAccount={onManageAccount}
            onLogout={onLogout}
          />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 rounded-none md:my-2 md:mr-2 md:rounded-2xl md:ring-1 md:ring-border">
        <header className="flex h-14 items-center gap-2 border-b px-4 sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((breadcrumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                const Icon = breadcrumb.icon;
                const content = (
                  <span className="flex items-center gap-1.5">
                    {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
                    <span>{breadcrumb.label}</span>
                  </span>
                );
                return (
                  <Fragment key={breadcrumb.id}>
                    <BreadcrumbItem
                      className={isLast ? undefined : 'hidden sm:flex'}
                    >
                      {breadcrumb.href && !isLast ? (
                        <BreadcrumbLink asChild>
                          <AppLink
                            href={breadcrumb.href}
                            renderLink={renderLink}
                          >
                            {content}
                          </AppLink>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{content}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                    {!isLast ? (
                      <BreadcrumbSeparator className="hidden sm:block" />
                    ) : null}
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          {navbarActions ? (
            <div className="ml-auto flex items-center gap-1.5">
              {navbarActions}
            </div>
          ) : null}
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
