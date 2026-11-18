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
  type CSSProperties,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
  type SVGProps,
} from 'react';
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  CircleUserRound,
  Download,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Moon,
  Sun,
  TriangleAlert,
  UserRound,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@campuspilot/ui/components/collapsible';
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
  useSidebar,
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
  /** Lets the consuming app gate a complete navigation entry without fetching data in the shell. */
  wrap?: (children: ReactNode) => ReactNode;
};

/**
 * A sidebar entry that opens app-owned content in place instead of linking
 * to a page: pressing it expands `content` under it, pressing it again folds
 * it away. The shell renders the trigger and the fold; the app renders the
 * content (for example a list it reads from the API), so the shell still
 * fetches nothing.
 *
 * The content is mounted only while the entry is open (Radix Collapsible
 * unmounts closed content), so its reads start when the person opens it.
 * It sits inside the sidebar menu item, so it is usually a `SidebarMenuSub`;
 * its links close the mobile sheet when they use `AppShellSidebarSubLink`,
 * and code that navigates closes it with `useAppShellCloseMobileSidebar`.
 *
 * An inline fold was chosen over a popover because the same markup works in
 * the expanded desktop sidebar and in the mobile sheet (a popover beside an
 * 18rem sheet has no room on a phone, and a popover inside the sheet's modal
 * dialog adds a second layer to dismiss). The shell's sidebar collapses
 * off-canvas, never to icons, so there is no icon-only state to serve.
 */
export type AppShellNavigationDisclosure = {
  type: 'disclosure';
  id: string;
  label: string;
  icon: AppShellIcon;
  /** Whether the trigger is highlighted for the current path (for example while a page the content leads to is open). */
  isActive?: (currentPath: string) => boolean;
  /** App-owned content shown under the trigger while it is open. */
  content: ReactNode;
  /** Lets the consuming app gate the complete entry without fetching data in the shell. */
  wrap?: (children: ReactNode) => ReactNode;
};

export type AppShellNavigationGroup = {
  type: 'group';
  id: string;
  label: string;
  items: (AppShellNavigationItem | AppShellNavigationDisclosure)[];
};

export type AppShellNavigationEntry =
  | AppShellNavigationGroup
  | AppShellNavigationItem
  | AppShellNavigationDisclosure;

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

/** One alert row's height. Fixed (a row is one truncated line), so the shell can say how much room its alerts take. */
const APP_SHELL_ALERT_ROW_REM = 2.0625;
const APP_SHELL_ALERT_ROW_CLASS = 'h-[2.0625rem]';

/**
 * The height of the content area under the shell's header and its alert rows,
 * for a screen that fills the window instead of scrolling the page (the
 * assistant beside a question paper). The shell's content area grows with its
 * content, so "the rest of the window" has to be worked out from the viewport:
 * the 3.5rem header, on md+ also the inset's 0.5rem margins, and the alert
 * rows the shell is showing, which it publishes as `--app-shell-alerts` (one
 * row on a phone, up to two from md, as it renders them).
 */
export const APP_SHELL_FILL_HEIGHT_CLASS =
  'h-[calc(100dvh-3.5rem-var(--app-shell-alerts-sm,0px))] md:h-[calc(100dvh-4.5rem-var(--app-shell-alerts,0px))]';
/** The same height from md up only, for a screen that fills the window on wide screens and scrolls as a page on a phone. */
export const APP_SHELL_FILL_HEIGHT_MD_CLASS = 'md:h-[calc(100dvh-4.5rem-var(--app-shell-alerts,0px))]';

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
  /**
   * Higher shows first; alerts of equal priority keep the order they
   * registered in. Only the first two are shown (one on a phone), so an alert
   * that must always be seen, whatever the page registers (a read-only
   * school), takes a priority above the pages' own (0).
   */
  priority?: number;
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
  // Array.prototype.sort is stable, so equal priorities keep their registration order.
  return Array.from(
    new Map(registrations.map((alert) => [alert.slug, alert])).values(),
  ).sort((first, second) => (second.priority ?? 0) - (first.priority ?? 0));
}

type AppShellProps = {
  children: ReactNode;
  currentPath: string;
  navigation: AppShellNavigationEntry[];
  breadcrumbs: AppShellBreadcrumb[];
  sidebarHeader: ReactNode;
  search: ReactNode;
  /** App-owned control rendered after the footer links. */
  footerContent?: ReactNode;
  user: AppShellUser;
  docsHref?: string;
  /** App-owned links rendered between the shared Docs link and footer content. */
  footerLinks?: AppShellFooterLink[];
  navbarActions?: ReactNode;
  /** App-owned search trigger rendered after registered page actions. */
  navbarSearch?: ReactNode;
  onManageAccount?: () => void;
  /** Kept separate from the handler because browser installability can change at runtime. */
  isInstallAvailable?: boolean;
  onInstallApp?: () => void | Promise<void>;
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
 * Whether a click opens the link somewhere else (a new tab or window, a
 * download) instead of navigating this page: the sidebar then stays open,
 * because the user is still looking at it.
 */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    event.button !== 0
  );
}

/**
 * A link inside the sidebar. On mobile the sidebar is a sheet over the page,
 * so following one of its links closes the sheet; otherwise the new page
 * opens hidden behind it. Closing happens in the click handler, before the
 * navigation, rather than by watching the path: a link to the page that is
 * already open closes the sheet too, and no effect is needed. The caller's own
 * `onClick` runs first. On desktop `openMobile` is not used, so this does
 * nothing there.
 */
function SidebarAppLink({
  onClick,
  ...props
}: AppShellLinkProps & Pick<AppShellProps, 'renderLink'>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <AppLink
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (isMobile && !event.defaultPrevented && !opensElsewhere(event)) {
          setOpenMobile(false);
        }
      }}
    />
  );
}

/**
 * The app's link renderer, for links that app-owned sidebar content renders
 * (`AppShellSidebarSubLink`). Undefined renders a plain anchor, like the
 * shell's own links without `renderLink`.
 */
const AppShellRenderLinkContext = createContext<AppShellProps['renderLink']>(undefined);

/**
 * A sub-navigation link for app-owned sidebar content (a disclosure's
 * content): styled like the shell's sub-items, rendered with the app's
 * `renderLink`, and closing the mobile sheet when followed, exactly like the
 * shell's own links.
 */
export function AppShellSidebarSubLink({
  href,
  children,
  isActive = false,
}: {
  href: string;
  children: ReactNode;
  isActive?: boolean;
}) {
  const renderLink = useContext(AppShellRenderLinkContext);
  return (
    <SidebarMenuSubButton asChild isActive={isActive} className="rounded-lg">
      <SidebarAppLink href={href} renderLink={renderLink}>
        {children}
      </SidebarAppLink>
    </SidebarMenuSubButton>
  );
}

/**
 * Closes the mobile sidebar sheet, and does nothing on desktop. For
 * app-owned sidebar content that navigates in code (a searchable list
 * choosing an option) rather than through a link, which `SidebarAppLink`
 * already handles. Call it before navigating, in the event handler; no
 * effect watches the path.
 */
export function useAppShellCloseMobileSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  return useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
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
  priority,
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
      priority,
    }),
    [slug, message, type, icon, actionLabel, actionHref, onAction, priority],
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
              className={`${appearance.container} ${index === 1 ? 'hidden md:flex' : 'flex'} ${APP_SHELL_ALERT_ROW_CLASS} min-w-0 items-center gap-2 border-b px-4 text-xs sm:px-6`}
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

/**
 * One labelled group of the sidebar. The shell cannot know whether its items'
 * gates will render anything, so the consuming app leaves a group out of the
 * navigation when none of its items applies.
 */
function NavigationGroup({
  group,
  currentPath,
  renderLink,
}: {
  group: AppShellNavigationGroup;
  currentPath: string;
  renderLink?: AppShellProps['renderLink'];
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] uppercase tracking-widest">
        {group.label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {group.items.map((item) => (
            <NavigationEntryItem
              key={item.id}
              item={item}
              currentPath={currentPath}
              renderLink={renderLink}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** A link item or a disclosure, by its `type`. */
function NavigationEntryItem({
  item,
  currentPath,
  renderLink,
}: {
  item: AppShellNavigationItem | AppShellNavigationDisclosure;
  currentPath: string;
  renderLink?: AppShellProps['renderLink'];
}) {
  return item.type === 'disclosure' ? (
    <NavigationDisclosure item={item} currentPath={currentPath} />
  ) : (
    <NavigationItem item={item} currentPath={currentPath} renderLink={renderLink} />
  );
}

/**
 * A disclosure entry (see `AppShellNavigationDisclosure`). Radix keeps the
 * open state, so nothing here needs React state; the chevron turns while
 * the entry is open.
 */
function NavigationDisclosure({
  item,
  currentPath,
}: {
  item: AppShellNavigationDisclosure;
  currentPath: string;
}) {
  const Icon = item.icon;
  const content = (
    <Collapsible asChild className="group/disclosure">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={item.isActive?.(currentPath) ?? false}
            className="rounded-lg [&>span]:truncate"
          >
            <Icon />
            <span>{item.label}</span>
            <ChevronRight
              aria-hidden
              className="ml-auto transition-transform group-data-[state=open]/disclosure:rotate-90"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>{item.content}</CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
  return item.wrap ? item.wrap(content) : content;
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

  const content = (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} className="rounded-lg">
        <SidebarAppLink
          href={item.href}
          ariaCurrent={isDirectlyActive ? 'page' : undefined}
          renderLink={renderLink}
        >
          <Icon />
          <span>{item.label}</span>
        </SidebarAppLink>
      </SidebarMenuButton>
      {item.items?.length ? (
        <SidebarMenuSub>
          {item.items.map((child) => {
            const ChildIcon = child.icon;
            const isChildDirectlyActive = currentPath === child.href;
            const childContent = (
              <SidebarMenuSubItem>
                <SidebarMenuSubButton
                  asChild
                  isActive={pathMatches(child, currentPath)}
                  className="rounded-lg"
                >
                  <SidebarAppLink
                    href={child.href}
                    ariaCurrent={isChildDirectlyActive ? 'page' : undefined}
                    renderLink={renderLink}
                  >
                    <ChildIcon />
                    <span>{child.label}</span>
                  </SidebarAppLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
            // A sub-item is gated by its own `wrap`, exactly like a top-level item.
            return (
              <Fragment key={child.id}>
                {child.wrap ? child.wrap(childContent) : childContent}
              </Fragment>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
  return item.wrap ? item.wrap(content) : content;
}

export function AppShellUserMenu({
  user,
  onManageAccount,
  isInstallAvailable = false,
  onInstallApp,
  onLogout,
  trigger = 'sidebar',
}: Pick<
  AppShellProps,
  | 'user'
  | 'onManageAccount'
  | 'isInstallAvailable'
  | 'onInstallApp'
  | 'onLogout'
> & {
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
            {/* An unnamed account (for example one added by phone number)
                has no initials, so it gets a person icon. */}
            <AvatarFallback>{initials(user.name) || <UserRound aria-hidden />}</AvatarFallback>
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
        {isInstallAvailable && onInstallApp ? (
          <DropdownMenuItem onClick={onInstallApp}>
            <Download />
            Install app
          </DropdownMenuItem>
        ) : null}
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
  navbarSearch,
  onManageAccount,
  isInstallAvailable,
  onInstallApp,
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
      <AppShellRenderLinkContext.Provider value={renderLink}>
        <SidebarProvider
          style={{ '--sidebar-width': '16.5rem' } as React.CSSProperties}
        >
          <Sidebar variant="inset" className="p-2 pr-0">
            <SidebarHeader className="p-3">{sidebarHeader}</SidebarHeader>
            <SidebarContent>
              {navigation.map((entry) =>
                entry.type === 'group' ? (
                  <NavigationGroup
                    key={entry.id}
                    group={entry}
                    currentPath={currentPath}
                    renderLink={renderLink}
                  />
                ) : (
                  <SidebarGroup
                    key={entry.id}
                    className="mt-1/2 group-data-[collapsible=icon]:mt-0"
                  >
                    <SidebarGroupContent>
                      <SidebarMenu>
                        <NavigationEntryItem
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
                <SidebarAppLink href={docsHref} renderLink={renderLink}>
                  <BookOpen />
                  Docs
                </SidebarAppLink>
              </Button>
              {footerLinks.length > 0 ? <Separator className="my-1" /> : null}
              {footerLinks.map((link) => {
                const Icon = link.icon;

                return (
                  <Button
                    key={link.id}
                    asChild
                    variant="ghost"
                    className="justify-start rounded-lg px-2"
                  >
                    <SidebarAppLink href={link.href} renderLink={renderLink}>
                      <Icon />
                      {link.label}
                    </SidebarAppLink>
                  </Button>
                );
              })}
              {footerContent}
              <Separator className="my-2" />
              <AppShellUserMenu
                user={user}
                onManageAccount={onManageAccount}
                isInstallAvailable={isInstallAvailable}
                onInstallApp={onInstallApp}
                onLogout={onLogout}
              />
            </SidebarFooter>
          </Sidebar>
          <SidebarInset
            className="min-w-0 rounded-none md:my-2 md:mr-2 md:rounded-2xl md:ring-1 md:ring-border"
            style={
              {
                '--app-shell-alerts': `${Math.min(alerts.length, 2) * APP_SHELL_ALERT_ROW_REM}rem`,
                '--app-shell-alerts-sm': `${Math.min(alerts.length, 1) * APP_SHELL_ALERT_ROW_REM}rem`,
              } as CSSProperties
            }
          >
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
              {navbarActions || navbarSearch ? (
                <div className="ml-auto flex items-center gap-1.5">
                  {navbarActions}
                  {navbarSearch}
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
      </AppShellRenderLinkContext.Provider>
    </AppShellAlertRegistryContext.Provider>
  );
}
