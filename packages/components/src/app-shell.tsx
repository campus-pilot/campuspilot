'use client';

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentType,
  type MouseEventHandler,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  BookOpen,
  CircleAlert,
  CircleUserRound,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Moon,
  Sun,
  TriangleAlert,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@campuspilot/ui/components/dialog';
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
  isActive?: (currentPath: string) => boolean;
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

export type AppShellFooterLink = {
  id: string;
  label: string;
  href: string;
  icon: AppShellIcon;
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
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export type AppShellAlertType = 'normal' | 'warning' | 'destructive';

export type AppShellAlertDefinition = {
  /** Stable domain key. A newer registration with the same slug takes precedence. */
  slug: string;
  message: string;
  type?: AppShellAlertType;
  icon?: AppShellIcon;
  actionLabel?: string;
  actionHref?: string;
  /** The action decides whether and when to close the containing alert dialog. */
  onAction?: (closeDialog: () => void) => void | Promise<void>;
};

type RegisteredAppShellAlert = AppShellAlertDefinition & {
  registrationId: string;
};

type AppShellAlertRegistry = {
  register: (
    registrationId: string,
    alert: AppShellAlertDefinition,
  ) => void;
  unregister: (registrationId: string) => void;
};

const AppShellAlertRegistryContext = createContext<AppShellAlertRegistry | null>(
  null,
);

/**
 * Resolves one active alert per domain slug. The most recently mounted
 * registration wins while present; removing it reveals any older registration.
 */
function resolveRegisteredAlerts(registrations: RegisteredAppShellAlert[]) {
  return Array.from(
    new Map(registrations.map((alert) => [alert.slug, alert])).values(),
  );
}

type AppShellProps = {
  children: ReactNode;
  currentPath: string;
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  sidebarHeader: ReactNode;
  search: ReactNode;
  /** App-owned control rendered between search and footer links. */
  footerContent?: ReactNode;
  user: AppShellUser;
  docsHref?: string;
  /** App-owned links rendered directly above the shared Docs link. */
  footerLinks?: AppShellFooterLink[];
  navbarActions?: ReactNode;
  onManageAccount?: () => void;
  onLogout?: () => void | Promise<void>;
  renderLink?: (props: AppShellLinkProps) => ReactNode;
};

function pathMatches(item: AppShellNavigationItem, currentPath: string) {
  if (item.isActive) {
    return item.isActive(currentPath);
  }

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
  onClick,
  renderLink,
}: AppShellLinkProps & Pick<AppShellProps, 'renderLink'>) {
  return renderLink ? (
    renderLink({ href, children, className, ariaCurrent, onClick })
  ) : (
    <a
      href={href}
      className={className}
      aria-current={ariaCurrent}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/**
 * Declaratively registers an alert with the nearest AppShell. The callback ref
 * ties registration to the committed component lifetime without effect-driven
 * parent synchronization.
 */
export function AppShellAlert({
  slug,
  message,
  type = 'warning',
  icon,
  actionLabel,
  actionHref,
  onAction,
}: AppShellAlertDefinition) {
  const registry = useContext(AppShellAlertRegistryContext);
  const registrationId = useId();
  const alert = useMemo<AppShellAlertDefinition>(
    () => ({
      slug,
      message,
      type,
      icon,
      actionLabel,
      actionHref,
      onAction,
    }),
    [slug, message, type, icon, actionLabel, actionHref, onAction],
  );
  const registerNode = useCallback(
    (node: HTMLSpanElement | null) => {
      if (!registry) return;
      if (node) registry.register(registrationId, alert);
      else registry.unregister(registrationId);
    },
    [alert, registrationId, registry],
  );

  return <span ref={registerNode} hidden aria-hidden />;
}

function alertAppearance(type: AppShellAlertType) {
  switch (type) {
    case 'destructive':
      return {
        container: 'border-destructive/25 bg-destructive/10 text-destructive',
        icon: CircleAlert,
      };
    case 'normal':
      return {
        container: 'border-border bg-muted text-foreground',
        icon: MessageCircle,
      };
    case 'warning':
    default:
      return {
        container: 'border-primary/25 bg-primary/10 text-foreground',
        icon: TriangleAlert,
      };
  }
}

function AlertAction({
  alert,
  closeDialog,
  renderLink,
}: {
  alert: AppShellAlertDefinition;
  closeDialog: () => void;
  renderLink?: AppShellProps['renderLink'];
}) {
  if (!alert.actionLabel) return null;

  const className =
    'shrink-0 text-xs font-medium underline underline-offset-4 hover:text-foreground';

  if (alert.actionHref) {
    return (
      <AppLink
        href={alert.actionHref}
        className={className}
        renderLink={renderLink}
        onClick={() => void alert.onAction?.(closeDialog)}
      >
        {alert.actionLabel}
      </AppLink>
    );
  }

  if (alert.onAction) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => void alert.onAction?.(closeDialog)}
      >
        {alert.actionLabel}
      </button>
    );
  }

  return null;
}

function AppShellAlerts({
  alerts,
  renderLink,
}: {
  alerts: AppShellAlertDefinition[];
  renderLink?: AppShellProps['renderLink'];
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const closeDialog = useCallback(() => setIsDialogOpen(false), []);

  return (
    <>
      <div aria-label="Page alerts" className="flex flex-col">
        {alerts.slice(0, 2).map((alert, index) => {
          const type = alert.type ?? 'warning';
          const appearance = alertAppearance(type);
          const Icon = alert.icon ?? appearance.icon;

          return (
            <div
              key={alert.slug}
              role="alert"
              className={`${appearance.container} ${index === 1 ? 'hidden md:flex' : 'flex'} min-w-0 items-center gap-2 border-b px-4 py-2 text-xs sm:px-6`}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">
                {alert.message}
              </span>
              <button
                type="button"
                className="shrink-0 font-medium underline underline-offset-4 hover:text-foreground"
                onClick={() => setIsDialogOpen(true)}
              >
                View
              </button>
            </div>
          );
        })}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Alerts</DialogTitle>
            <DialogDescription>
              These alerts remain visible until the related issue is resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {alerts.map((alert) => {
              const type = alert.type ?? 'warning';
              const appearance = alertAppearance(type);
              const Icon = alert.icon ?? appearance.icon;

              return (
                <div
                  key={alert.slug}
                  className={`${appearance.container} flex items-start gap-3 rounded-lg border p-3 text-left`}
                >
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="text-sm leading-relaxed">{alert.message}</p>
                    {alert.actionLabel ? (
                      <div>
                        <AlertAction
                          alert={alert}
                          closeDialog={closeDialog}
                          renderLink={renderLink}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
      <SidebarMenuButton asChild isActive={isActive} className="rounded-lg">
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

export function AppShellUserMenu({
  user,
  onManageAccount,
  onLogout,
  trigger = 'sidebar',
}: Pick<AppShellProps, 'user' | 'onManageAccount' | 'onLogout'> & {
  trigger?: 'avatar' | 'sidebar';
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const isAvatarTrigger = trigger === 'avatar';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={
            isAvatarTrigger
              ? 'size-9 rounded-full p-0'
              : 'h-auto w-full justify-start rounded-lg px-2 py-1.5'
          }
          aria-label={isAvatarTrigger ? 'Open account menu' : undefined}
        >
          <Avatar size="sm">
            {user.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          {!isAvatarTrigger ? (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium">{user.name}</span>
                <span className="block truncate text-[10px] font-normal text-muted-foreground">
                  {user.secondaryLabel}
                </span>
              </span>
              <MoreHorizontal />
            </>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={isAvatarTrigger ? 'bottom' : 'top'}
        align={isAvatarTrigger ? 'end' : 'start'}
        className="w-60 rounded-xl"
      >
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
  footerContent,
  user,
  docsHref = '/docs',
  footerLinks = [],
  navbarActions,
  onManageAccount,
  onLogout,
  renderLink,
}: AppShellProps) {
  const [registeredAlerts, setRegisteredAlerts] = useState<
    RegisteredAppShellAlert[]
  >([]);
  const alertRegistry = useMemo<AppShellAlertRegistry>(
    () => ({
      register: (registrationId, alert) => {
        setRegisteredAlerts((current) => {
          const existingIndex = current.findIndex(
            (entry) => entry.registrationId === registrationId,
          );
          const next = { ...alert, registrationId };
          if (existingIndex === -1) return [...current, next];
          return current.map((entry, index) =>
            index === existingIndex ? next : entry,
          );
        });
      },
      unregister: (registrationId) => {
        setRegisteredAlerts((current) =>
          current.filter((entry) => entry.registrationId !== registrationId),
        );
      },
    }),
    [],
  );
  const alerts = resolveRegisteredAlerts(registeredAlerts);

  return (
    <AppShellAlertRegistryContext.Provider value={alertRegistry}>
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
                  className="mt-1/2 group-data-[collapsible=icon]:mt-0"
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
            {footerContent}
            {footerLinks.map((link) => {
              const Icon = link.icon;

              return (
                <Button
                  key={link.id}
                  asChild
                  variant="ghost"
                  className="justify-start rounded-lg px-2"
                >
                  <AppLink href={link.href} renderLink={renderLink}>
                    <Icon />
                    {link.label}
                  </AppLink>
                </Button>
              );
            })}
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
            <AppShellUserMenu
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
          {alerts.length ? (
            <AppShellAlerts alerts={alerts} renderLink={renderLink} />
          ) : null}
          <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AppShellAlertRegistryContext.Provider>
  );
}
