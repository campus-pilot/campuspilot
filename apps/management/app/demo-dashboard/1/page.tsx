"use client";

import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleUserRound,
  ClipboardCheck,
  Command,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sun,
  Users,
  WalletCards,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@campuspilot/ui/components/avatar";
import { Badge } from "@campuspilot/ui/components/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@campuspilot/ui/components/breadcrumb";
import { Button } from "@campuspilot/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@campuspilot/ui/components/card";
import { Popover, PopoverContent, PopoverTrigger } from "@campuspilot/ui/components/popover";
import { Progress } from "@campuspilot/ui/components/progress";
import { Separator } from "@campuspilot/ui/components/separator";
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
  SidebarProvider,
  SidebarTrigger,
} from "@campuspilot/ui/components/sidebar";

const groups = [
  { label: "Workspace", items: [["Overview", LayoutDashboard], ["People", Users], ["Calendar", CalendarDays]] },
  { label: "Departments", items: [["Management", Building2], ["Finances", WalletCards], ["Classroom", GraduationCap], ["Examinations", ClipboardCheck]] },
];

export default function DashboardOne() {
  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
      <Sidebar variant="inset" className="p-2 pr-0">
        <SidebarHeader className="gap-3 p-3">
          <Button variant="ghost" className="h-auto w-full justify-between p-1 text-left">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><GraduationCap className="size-4" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">Northstar Academy</span><span className="block text-[11px] font-normal text-muted-foreground">Academic year 2026–27</span></span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </SidebarHeader>
        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="uppercase tracking-widest text-[10px]">{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map(([label, Icon]) => (
                    <SidebarMenuItem key={label as string}>
                      <SidebarMenuButton isActive={label === "Overview"} className="rounded-lg px-2.5" tooltip={label as string}>
                        <Icon /><span>{label as string}</span>{["Management", "Finances", "Classroom", "Examinations"].includes(label as string) && <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="gap-1 p-3">
          <Button variant="ghost" className="justify-start rounded-lg px-2"><Search />Search<span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"><Command className="size-3" />K</span></Button>
          <Button asChild variant="ghost" className="justify-start rounded-lg px-2"><a href="/docs"><BookOpen />Documentation</a></Button>
          <Separator className="my-2" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="h-auto w-full justify-start rounded-lg px-2 py-1.5">
                <Avatar size="sm"><AvatarFallback>AS</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1 text-left"><span className="block truncate font-medium">Aarav Sharma</span><span className="block truncate text-[10px] font-normal text-muted-foreground">Admin</span></span>
                <MoreHorizontal className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-60 rounded-xl p-2">
              <div className="px-2 py-1.5"><p className="font-medium">Aarav Sharma</p><p className="text-muted-foreground">aarav@northstar.edu</p></div><Separator />
              <Button variant="ghost" className="w-full justify-start rounded-lg"><CircleUserRound />Manage account</Button>
              <Button variant="ghost" className="w-full justify-start rounded-lg"><Sun />Theme<span className="ml-auto text-muted-foreground">System</span></Button>
              <Separator /><Button variant="ghost" className="w-full justify-start rounded-lg text-destructive hover:text-destructive"><LogOut />Log out</Button>
            </PopoverContent>
          </Popover>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-hidden rounded-none md:my-2 md:mr-2 md:rounded-2xl md:ring-1 md:ring-border">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 sm:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap text-xs"><BreadcrumbItem className="hidden sm:block"><BreadcrumbLink href="#">Northstar Academy</BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator className="hidden sm:block" /><BreadcrumbItem><BreadcrumbPage>Overview</BreadcrumbPage></BreadcrumbItem></BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-1.5"><Button variant="ghost" size="icon-sm"><CircleHelp /></Button><Button variant="ghost" size="icon-sm"><Bell /></Button><Button size="sm" className="rounded-lg"><Plus />New admission</Button></div>
        </header>

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><p className="mb-1 text-xs text-muted-foreground">Friday, 11 September</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Good morning, Aarav</h1><p className="mt-1 text-sm text-muted-foreground">Here’s what’s happening across your campus today.</p></div>
              <Button variant="outline" className="w-fit rounded-lg"><CalendarDays />This month<ChevronDown /></Button>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ["Total students", "2,846", "+8.2%", Users, true],
                ["Fee collected", "₹18.4L", "+12.5%", CreditCard, true],
                ["Attendance", "92.6%", "+1.4%", ClipboardCheck, true],
                ["Pending dues", "₹3.2L", "-4.8%", WalletCards, false],
              ].map(([label, value, change, Icon, up]) => {
                const StatIcon = Icon as typeof Users;
                return (
                <Card key={label as string} className="gap-3 rounded-xl py-4 shadow-none">
                  <CardHeader className="flex-row items-center justify-between px-4"><span className="text-xs text-muted-foreground">{label as string}</span><span className="grid size-7 place-items-center rounded-lg bg-muted"><StatIcon className="size-3.5" /></span></CardHeader>
                  <CardContent className="px-4"><p className="text-xl font-semibold sm:text-2xl">{value as string}</p><p className={`mt-1 flex items-center gap-1 text-[11px] ${up ? "text-chart-4" : "text-muted-foreground"}`}>{up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{change as string} <span className="text-muted-foreground">from last month</span></p></CardContent>
                </Card>
              )})}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <Card className="rounded-xl py-5 shadow-none">
                <CardHeader className="flex-row items-center justify-between px-5"><div><CardTitle>Attendance overview</CardTitle><p className="mt-1 text-xs text-muted-foreground">Daily student attendance this week</p></div><Badge variant="secondary" className="rounded-md">92.6% avg.</Badge></CardHeader>
                <CardContent className="px-5 pt-4">
                  <div className="flex h-52 items-end gap-3 border-b border-dashed sm:gap-6">
                    {[76, 90, 68, 94, 84, 50, 36].map((height, index) => <div key={index} className="flex h-full flex-1 items-end"><div className="w-full rounded-t-md bg-chart-2/15 p-1" style={{ height: `${height}%` }}><div className="h-full w-full rounded-t-sm bg-chart-2/75" /></div></div>)}
                  </div>
                  <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day}>{day}</span>)}</div>
                </CardContent>
              </Card>
              <Card className="rounded-xl py-5 shadow-none">
                <CardHeader className="px-5"><CardTitle>Department progress</CardTitle><p className="text-xs text-muted-foreground">Monthly targets</p></CardHeader>
                <CardContent className="flex flex-col gap-5 px-5 pt-2">
                  {[["Management", 84], ["Finances", 68], ["Classroom", 91], ["Examinations", 57]].map(([name, value]) => <div key={name as string}><div className="mb-2 flex justify-between"><span>{name as string}</span><span className="text-muted-foreground">{value as number}%</span></div><Progress value={value as number} className="[&_[data-slot=progress-track]]:rounded-full [&_[data-slot=progress-indicator]]:rounded-full" /></div>)}
                </CardContent>
              </Card>
            </div>

            <Card className="rounded-xl py-0 shadow-none">
              <div className="flex items-center justify-between border-b px-5 py-4"><div><CardTitle>Recent activity</CardTitle><p className="mt-1 text-xs text-muted-foreground">Latest updates across your campus</p></div><Button variant="ghost" size="sm">View all<ChevronRight /></Button></div>
              <div className="divide-y">
                {[["AS", "Admissions", "12 new student applications received", "8 min"], ["FK", "Finances", "Fee payment recorded for Grade 8", "24 min"], ["RN", "Examination", "Term I schedule was published", "1 hr"]].map(([initials, team, note, time]) => <div key={note} className="flex items-center gap-3 px-5 py-3.5"><Avatar size="sm"><AvatarFallback>{initials}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{note}</p><p className="text-[11px] text-muted-foreground">{team}</p></div><span className="shrink-0 text-[10px] text-muted-foreground">{time}</span></div>)}
              </div>
            </Card>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
