import Link from 'next/link';
import { ArrowRightIcon, ChevronRightIcon, MegaphoneIcon, SparklesIcon } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Card, CardContent } from '@campuspilot/ui/components/card';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@campuspilot/ui/components/item';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@campuspilot/ui/components/reui/alert';
import { Badge } from '@campuspilot/ui/components/reui/badge';

import { SectionLabel } from './concept-shell';
import { calendarEvents, feeSummary, formatInr, notices, student } from './mock-data';

/** Greets by first name and states the session so a guardian knows which year they are looking at. */
function Greeting() {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm text-muted-foreground">Good morning</p>
      <h1 className="text-2xl font-semibold tracking-tight">Hi, {student.name.split(' ')[0]}</h1>
      <p className="text-xs text-muted-foreground">
        Session {student.session} · Roll {student.rollNo} · Adm. {student.admissionNo}
      </p>
    </div>
  );
}

/** The single most important money fact: what is owed and by when. */
function FeeDueCard() {
  return (
    <Card className="gap-0 overflow-hidden border-primary/20 bg-primary/5 py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Fees outstanding</span>
          <Badge variant="warning-light" radius="full">Due {feeSummary.nextDueOn}</Badge>
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{formatInr(feeSummary.outstanding)}</p>
        <p className="text-xs text-muted-foreground">Includes {formatInr(2000)} left over from October.</p>
        <Button asChild size="lg" className="w-full">
          <Link href="/concept/fees">
            View dues & receipts <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Appears only while a newly released result is unseen; the release is the school's explicit act. */
function ResultReleasedAlert() {
  return (
    <Alert variant="success">
      <SparklesIcon />
      <AlertTitle>Half-Yearly results are out</AlertTitle>
      <AlertDescription>Released 4 Oct · 82.4% · Grade A</AlertDescription>
      <AlertAction>
        <Button asChild variant="outline" size="sm">
          <Link href="/concept/results/half-yearly">Open</Link>
        </Button>
      </AlertAction>
    </Alert>
  );
}

function LatestNotices() {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel action={<Link href="/concept/updates" className="text-xs font-medium text-primary">See all</Link>}>
        From school
      </SectionLabel>
      <ItemGroup className="gap-0 rounded-lg border">
        {notices.slice(0, 2).map((notice) => (
          <Item key={notice.id} asChild className="rounded-none border-b border-b-border last:border-b-0">
            <Link href="/concept/updates">
              <ItemMedia variant="icon">
                <MegaphoneIcon className="text-muted-foreground" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{notice.title}</ItemTitle>
                <ItemDescription className="line-clamp-1">{notice.body}</ItemDescription>
              </ItemContent>
              <ItemActions className="text-xs text-muted-foreground">
                {notice.date}
                <ChevronRightIcon className="size-4" />
              </ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}

function NextUp() {
  const next = calendarEvents[0]!;
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>Coming up</SectionLabel>
      <Item variant="outline">
        <ItemMedia className="flex size-11 flex-col items-center justify-center rounded-md bg-muted leading-none">
          <span className="text-[0.625rem] font-medium uppercase text-muted-foreground">{next.month}</span>
          <span className="text-base font-semibold">{next.day}</span>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{next.title}</ItemTitle>
          <ItemDescription>{next.detail}</ItemDescription>
        </ItemContent>
      </Item>
    </section>
  );
}

/**
 * Time-bound school news leads (a fresh result, what's coming up, notices);
 * the fee balance follows. Section shortcuts are left to the bottom nav.
 */
export function HomeScreen() {
  return (
    <>
      <Greeting />
      <ResultReleasedAlert />
      <NextUp />
      <LatestNotices />
      <FeeDueCard />
    </>
  );
}
