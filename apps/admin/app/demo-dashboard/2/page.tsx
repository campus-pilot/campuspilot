'use client';

import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardCheck,
  Command,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Sun,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@campuspilot/ui/components/avatar';
import { Badge } from '@campuspilot/ui/components/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@campuspilot/ui/components/breadcrumb';
import { Button } from '@campuspilot/ui/components/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@campuspilot/ui/components/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@campuspilot/ui/components/popover';
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@campuspilot/ui/components/sidebar';

export default function DashboardTwo() {
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '16.5rem' } as React.CSSProperties}
    >
      <Sidebar variant="inset" className="p-2 pr-0">
        <SidebarHeader className="p-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between rounded-xl p-1"
              >
                <span className="flex items-center gap-2.5">
                  <span className="grid size-8 place-items-center rounded-xl bg-foreground text-background">
                    <Building2 className="size-4" />
                  </span>
                  <span className="text-left">
                    <span className="block text-sm font-semibold">
                      Riverdale School
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      Main campus
                    </span>
                  </span>
                </span>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 rounded-xl">
              <p className="px-2 font-medium">Switch organization</p>
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg"
              >
                <Building2 />
                Riverdale School
                <Check className="ml-auto" />
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg"
              >
                <Plus />
                Add organization
              </Button>
            </PopoverContent>
          </Popover>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="uppercase tracking-widest text-[10px]">
              General
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {[
                  ['Home', LayoutGrid],
                  ['Calendar', CalendarDays],
                  ['People', Users],
                ].map(([name, Icon]) => (
                  <SidebarMenuItem key={name as string}>
                    <SidebarMenuButton
                      isActive={name === 'Home'}
                      className="rounded-lg"
                    >
                      <Icon />
                      <span>{name as string}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel className="uppercase tracking-widest text-[10px]">
              Departments
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton className="rounded-lg">
                    <Building2 />
                    <span>admin</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton className="rounded-lg">
                    <CreditCard />
                    <span>Finances</span>
                    <SidebarMenuBadge>4</SidebarMenuBadge>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton className="rounded-lg">
                    <GraduationCap />
                    <span>Classroom</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton className="rounded-lg">
                    <ClipboardCheck />
                    <span>Examination</span>
                    <ChevronRight className="ml-auto" />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-1 p-3">
          <Button variant="ghost" className="justify-start rounded-lg px-2">
            <Search />
            Search
            <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <Command className="size-3" />K
            </span>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="justify-start rounded-lg px-2"
          >
            <a href="/docs">
              <BookOpen />
              Docs
            </a>
          </Button>
          <Separator className="my-2" />
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start rounded-lg px-2 py-1.5"
              >
                <Avatar size="sm">
                  <AvatarFallback>NK</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">Nisha Kapoor</span>
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    School owner
                  </span>
                </span>
                <MoreHorizontal />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-60 rounded-xl"
            >
              <div className="px-2 py-1">
                <p className="font-medium">Nisha Kapoor</p>
                <p className="text-muted-foreground">nisha@riverdale.edu</p>
              </div>
              <Separator />
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg"
              >
                <CircleUserRound />
                Manage account
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg"
              >
                <Moon />
                Theme
                <span className="ml-auto text-muted-foreground">Light</span>
              </Button>
              <Separator />
              <Button
                variant="ghost"
                className="w-full justify-start rounded-lg text-destructive hover:text-destructive"
              >
                <LogOut />
                Log out
              </Button>
            </PopoverContent>
          </Popover>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 rounded-none md:my-2 md:mr-2 md:rounded-2xl md:ring-1 md:ring-border">
        <header className="flex h-14 items-center gap-2 border-b px-4 sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Breadcrumb>
            <BreadcrumbList className="text-xs">
              <BreadcrumbItem className="hidden sm:block">
                Riverdale
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Home</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex gap-1.5">
            <Button variant="ghost" size="icon-sm">
              <Bell />
            </Button>
            <Button variant="outline" size="sm" className="rounded-lg">
              <Plus />
              Quick add
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-7">
            <div>
              <Badge variant="secondary" className="mb-3 rounded-md">
                Friday · 11 September
              </Badge>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Your campus at a glance
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                A focused view of what needs your attention today.
              </p>
            </div>

            <section className="grid gap-3 sm:grid-cols-3">
              {[
                ['Students present', '2,624', '92.2%', Users],
                ['Staff present', '184', '96.8%', CircleUserRound],
                ['Fees due today', '₹84,200', '18 families', CreditCard],
              ].map(([label, value, sub, Icon]) => (
                <Card
                  key={label as string}
                  className="relative rounded-2xl py-5 shadow-none"
                >
                  <CardContent className="px-5">
                    <span className="mb-7 grid size-8 place-items-center rounded-xl bg-muted">
                      <Icon className="size-4" />
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {label as string}
                    </p>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <p className="text-2xl font-semibold">
                        {value as string}
                      </p>
                      <Badge variant="outline" className="rounded-md">
                        {sub as string}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
              <Card className="rounded-2xl py-0 shadow-none">
                <CardHeader className="border-b px-5 py-4">
                  <div>
                    <CardTitle>Today’s schedule</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Friday, 11 September
                    </p>
                  </div>
                  <Button variant="ghost" size="sm">
                    Full calendar
                    <ChevronRight />
                  </Button>
                </CardHeader>
                <CardContent className="px-5 py-2">
                  {[
                    [
                      '09:00',
                      'Weekly leadership sync',
                      'Conference room',
                      'admin',
                    ],
                    ['11:30', 'Parent orientation', 'Auditorium', 'Admissions'],
                    [
                      '14:00',
                      'Grade 10 faculty review',
                      'Meeting room 2',
                      'Classroom',
                    ],
                    ['16:30', 'Term exam planning', 'Online', 'Examination'],
                  ].map(([time, title, place, team], index) => (
                    <div
                      key={title}
                      className="flex gap-4 border-b py-4 last:border-0"
                    >
                      <div className="w-12 shrink-0 text-xs font-medium">
                        {time}
                      </div>
                      <div className="relative flex min-w-0 flex-1 gap-3 before:absolute before:-left-[1.18rem] before:top-1 size-2 before:rounded-full before:bg-chart-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">
                            {title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {place} · {team}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="rounded-2xl py-0 shadow-none">
                <CardHeader className="border-b px-5 py-4">
                  <div>
                    <CardTitle>Needs attention</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      4 items are waiting
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="px-3 py-2">
                  {[
                    [
                      '18 overdue invoices',
                      'Review fee collection',
                      CreditCard,
                      'High',
                    ],
                    [
                      '6 leave requests',
                      'Pending your approval',
                      FileText,
                      'Today',
                    ],
                    [
                      'Exam timetable',
                      'Needs final review',
                      ClipboardCheck,
                      'Draft',
                    ],
                    ['Staff onboarding', '2 profiles incomplete', Users, '2'],
                  ].map(([title, note, Icon, tag]) => (
                    <Button
                      key={title as string}
                      variant="ghost"
                      className="h-auto w-full justify-start rounded-xl px-2 py-3 text-left"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {title as string}
                        </span>
                        <span className="block truncate text-[10px] font-normal text-muted-foreground">
                          {note as string}
                        </span>
                      </span>
                      <Badge variant="secondary" className="rounded-md">
                        {tag as string}
                      </Badge>
                    </Button>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Quick actions</h2>
                  <p className="text-xs text-muted-foreground">
                    Common jobs, one tap away
                  </p>
                </div>
                <Button variant="ghost" size="icon-sm">
                  <Settings2 />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Add student', Users],
                  ['Record payment', CreditCard],
                  ['Create notice', FileText],
                  ['Plan exam', ClipboardCheck],
                ].map(([label, Icon]) => (
                  <Button
                    key={label as string}
                    variant="outline"
                    className="h-24 flex-col gap-3 rounded-2xl bg-card"
                  >
                    <span className="grid size-8 place-items-center rounded-xl bg-muted">
                      <Icon className="size-4" />
                    </span>
                    {label as string}
                  </Button>
                ))}
              </div>
            </section>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
