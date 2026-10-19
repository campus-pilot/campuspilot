'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import type { SchoolSessionDto } from '@campuspilot/api/routers/school/session/session.dto';
import { Button } from '@campuspilot/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@campuspilot/ui/components/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@campuspilot/ui/components/popover';
import { CalendarRange, Check, ChevronsUpDown } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { z } from 'zod';
import { schoolSessionHref } from './school-route';
import { confirmNavigation } from '@/lib/navigation-guard';
import { storeSchoolSessionId } from './session-selection';

const sessionSwitcherSchema = z.object({
  sessionId: z.string().min(1),
  searchQuery: z.string().max(100),
});

function sessionLabel(session: SchoolSessionDto) {
  return `${session.sessionStartYear}-${session.sessionEndYear}`;
}

/** Keeps the sidebar trigger compact while the picker retains unambiguous full years. */
function compactSessionLabel(session: SchoolSessionDto) {
  return `${String(session.sessionStartYear).slice(-2)}-${String(session.sessionEndYear).slice(-2)}`;
}

/** Keeps the current session-scoped subpage when changing academic sessions. */
function sessionSuffixFromPath(pathname: string) {
  return /^\/school\/[^/]+\/sessions\/[^/]+(\/.*)?$/.exec(pathname)?.[1] ?? '';
}

export function SessionSwitcher({
  schoolId,
  selectedSessionId,
  sessions,
}: {
  schoolId: string;
  selectedSessionId?: string;
  sessions: SchoolSessionDto[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const selectedSession = sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const form = useForm({
    defaultValues: { sessionId: selectedSessionId ?? '', searchQuery: '' },
    validators: { onChange: sessionSwitcherSchema },
  });

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (!nextOpen) form.reset();
  }

  async function selectSession(sessionId: string) {
    if (!(await confirmNavigation())) return;
    storeSchoolSessionId(schoolId, sessionId);
    handleOpenChange(false);
    // Exam plans are scoped to one session; a session change returns to its examination list.
    const suffix = sessionSuffixFromPath(pathname);
    router.push(
      schoolSessionHref(
        schoolId,
        sessionId,
        suffix.startsWith('/exam/') ? '/exam' : suffix,
      ),
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full min-w-0 justify-start rounded-lg px-2"
          disabled={sessions.length === 0}
          aria-label={
            selectedSession
              ? `Switch session, current session ${sessionLabel(selectedSession)}`
              : 'Switch session, no session selected'
          }
        >
          <CalendarRange aria-hidden />
          <span className="min-w-0 truncate">
            {selectedSession
              ? compactSessionLabel(selectedSession)
              : 'No session'}
          </span>
          <ChevronsUpDown className="ml-auto" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <form.Field name="searchQuery">
            {(field) => (
              <CommandInput
                placeholder="Search sessions…"
                maxLength={100}
                value={field.state.value}
                onBlur={field.handleBlur}
                onValueChange={field.handleChange}
              />
            )}
          </form.Field>
          <CommandList>
            <CommandEmpty>No sessions found.</CommandEmpty>
            <CommandGroup heading="Academic sessions">
              <form.Field name="sessionId">
                {(field) =>
                  sessions.map((session) => (
                    <CommandItem
                      key={session.id}
                      value={sessionLabel(session)}
                      onSelect={() => {
                        field.handleChange(session.id);
                        selectSession(session.id);
                      }}
                    >
                      <Check
                        className={
                          session.id === selectedSessionId
                            ? 'opacity-100'
                            : 'opacity-0'
                        }
                        aria-hidden
                      />
                      <span>{sessionLabel(session)}</span>
                      {session.isActive ? (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          Active
                        </span>
                      ) : null}
                    </CommandItem>
                  ))
                }
              </form.Field>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
