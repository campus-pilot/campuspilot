import { MegaphoneIcon, PalmtreeIcon, PartyPopperIcon, PenLineIcon, UsersIcon } from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@campuspilot/ui/components/item';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { Badge } from '@campuspilot/ui/components/reui/badge';
import { IconTile } from '@campuspilot/ui/components/reui/icon-tile';
import { cn } from '@campuspilot/ui/lib/utils';

import { ScreenHeader, SectionLabel } from './concept-shell';
import { calendarEvents, notices } from './mock-data';

type EventKind = (typeof calendarEvents)[number]['kind'];

const kindStyle: Record<EventKind, { icon: typeof PartyPopperIcon; tone: string }> = {
  Event: { icon: PartyPopperIcon, tone: 'text-sky-600' },
  Meeting: { icon: UsersIcon, tone: 'text-violet-600' },
  Holiday: { icon: PalmtreeIcon, tone: 'text-emerald-600' },
  Exam: { icon: PenLineIcon, tone: 'text-amber-600' },
};

/** Future: school notices, newest first; unread ones carry a dot. */
function NoticeList() {
  return (
    <ItemGroup className="gap-0 rounded-lg border">
      {notices.map((notice, index) => (
        <Item key={notice.id} className="items-start rounded-none border-b border-b-border last:border-b-0">
          <ItemMedia variant="icon" className="relative mt-0.5">
            <MegaphoneIcon className="text-muted-foreground" />
            {index === 0 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary" /> : null}
          </ItemMedia>
          <ItemContent>
            <div className="flex items-center justify-between gap-2">
              <ItemTitle className={cn(index === 0 && 'font-semibold')}>{notice.title}</ItemTitle>
              <span className="shrink-0 text-xs text-muted-foreground">{notice.date}</span>
            </div>
            <ItemDescription>{notice.body}</ItemDescription>
            <Badge variant="outline" radius="full" className="mt-1">
              {notice.tag}
            </Badge>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  );
}

/** Future: agenda view of events and vacations; an agenda list reads better than a month grid on a phone. */
function CalendarAgenda() {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Next 4 months</SectionLabel>
      {calendarEvents.map((event) => {
        const { icon: Icon, tone } = kindStyle[event.kind];
        return (
          <Item key={event.id} variant="outline">
            <ItemMedia className="flex size-11 flex-col items-center justify-center rounded-md bg-muted leading-none">
              <span className="text-[0.625rem] font-medium uppercase text-muted-foreground">{event.month}</span>
              <span className="text-base font-semibold">{event.day}</span>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{event.title}</ItemTitle>
              <ItemDescription>{event.detail}</ItemDescription>
            </ItemContent>
            <IconTile variant="soft" size="sm" className={tone}>
              <Icon />
            </IconTile>
          </Item>
        );
      })}
    </div>
  );
}

export function UpdatesScreen() {
  return (
    <>
      <ScreenHeader title="Updates" description="Notices and the school calendar" />
      <Tabs defaultValue="notices">
        <TabsList className="w-full">
          <TabsTrigger value="notices">Notices</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>
        <TabsContent value="notices">
          <NoticeList />
        </TabsContent>
        <TabsContent value="calendar">
          <CalendarAgenda />
        </TabsContent>
      </Tabs>
    </>
  );
}

