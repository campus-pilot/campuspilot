'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { z } from 'zod';
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
import { Building2, ChevronsUpDown } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { SchoolAvatar } from './school-avatar';
import { schoolHref } from './school-route';
import { confirmNavigation } from '@/lib/navigation-guard';
import { storeSchoolId } from './school-selection';

const switcherSearchSchema = z.object({ searchQuery: z.string().max(200) });

function SearchFieldErrors({ errors }: { errors: unknown[] }) {
  return errors.map((error, index) => {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String(error.message)
        : undefined;

    return message ? (
      <p key={`${message}-${index}`} className="px-2 text-xs text-destructive">
        {message}
      </p>
    ) : null;
  });
}

function schoolIdFromPath(pathname: string) {
  const match = /^\/school\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function SchoolSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const schoolsQuery = useQuery(orpc.school.listMySchools.queryOptions());
  const selectedSchoolId = schoolIdFromPath(pathname);
  const selectedSchool = schoolsQuery.data?.find(
    (school) => school.id === selectedSchoolId,
  );
  const searchForm = useForm({
    defaultValues: { searchQuery: '' },
    validators: { onChange: switcherSearchSchema },
  });

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (!nextOpen) searchForm.reset();
  }

  const label = schoolsQuery.isPending
    ? 'Loading schools…'
    : schoolsQuery.isError
      ? 'Unable to load schools'
      : selectedSchool?.name ?? 'Select a school';

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full min-w-0 justify-start rounded-xl p-1"
        >
          {selectedSchool ? (
            <SchoolAvatar school={selectedSchool} />
          ) : (
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background">
              <Building2 className="size-4" />
            </span>
          )}
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-semibold">{label}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {selectedSchool?.location ?? 'School workspace'}
            </span>
          </span>
          <ChevronsUpDown className="ml-auto size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <searchForm.Field name="searchQuery">
            {(field) => (
              <>
                <CommandInput
                  placeholder="Search schools…"
                  maxLength={200}
                  value={field.state.value}
                  aria-invalid={field.state.meta.errors.length > 0}
                  onBlur={field.handleBlur}
                  onValueChange={field.handleChange}
                />
                <SearchFieldErrors errors={field.state.meta.errors} />
              </>
            )}
          </searchForm.Field>
          <CommandList>
            <CommandEmpty>No schools match your search.</CommandEmpty>
            <CommandGroup heading="Your schools">
              {schoolsQuery.data?.map((school) => (
                <CommandItem
                  key={school.id}
                  value={`${school.name} ${school.location}`}
                  data-checked={school.id === selectedSchoolId}
                  onSelect={() => {
                    if (!confirmNavigation()) return;
                    handleOpenChange(false);
                    storeSchoolId(school.id);
                    router.push(schoolHref(school.id));
                  }}
                >
                  <SchoolAvatar school={school} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate">{school.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {school.location}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
