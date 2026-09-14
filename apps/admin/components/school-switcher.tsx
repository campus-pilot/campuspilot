'use client';

import { Component, Suspense, useRef, useState, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
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
import { Building2, ChevronsUpDown, Plus } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import { AddSchoolDialog } from './add-school-dialog';
import { SchoolAvatar } from './school-avatar';

const SEARCH_DEBOUNCE_MS = 300;

const schoolSearchSchema = z.object({
  searchQuery: z.string().max(200),
});

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

function schoolIdFromPath(pathname: string): string | undefined {
  const match = /^\/school\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function SchoolResultsFallback() {
  return (
    <CommandGroup heading="Schools">
      <CommandItem disabled forceMount>Loading schools…</CommandItem>
    </CommandGroup>
  );
}

function SchoolResults({
  searchQuery,
  selectedSchoolId,
  onSelect,
}: {
  searchQuery?: string;
  selectedSchoolId?: string;
  onSelect: (schoolId: string) => void;
}) {
  const { data } = useSuspenseQuery(
    orpc.systemAdmin.listSchools.queryOptions({
      input: searchQuery ? { searchQuery } : {},
    }),
  );

  if (data.items.length === 0) {
    return <CommandEmpty>No schools match your search.</CommandEmpty>;
  }

  return (
    <CommandGroup heading="Schools">
      {data.items.map((school) => (
        <CommandItem
          key={school.id}
          value={school.id}
          data-checked={school.id === selectedSchoolId}
          onSelect={() => onSelect(school.id)}
        >
          <SchoolAvatar school={school} size="sm" />
          <span className="truncate">{school.name}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

class SchoolResultsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <CommandGroup heading="Schools">
          <CommandItem disabled forceMount>Schools could not be loaded</CommandItem>
        </CommandGroup>
      );
    }

    return this.props.children;
  }
}

export function SchoolSwitcher() {
  const [isAddSchoolOpen, setIsAddSchoolOpen] = useState(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>();
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pathname = usePathname();
  const router = useRouter();
  const schoolsQuery = useQuery(orpc.systemAdmin.listSchools.queryOptions({ input: {} }));
  const selectedSchoolId = schoolIdFromPath(pathname);
  const selectedSchoolQuery = useQuery({
    ...orpc.systemAdmin.getSchool.queryOptions({
      input: { id: selectedSchoolId ?? '' },
    }),
    enabled: selectedSchoolId !== undefined,
  });
  const selectedSchool =
    selectedSchoolQuery.data ??
    schoolsQuery.data?.items.find((school) => school.id === selectedSchoolId);
  const searchForm = useForm({
    defaultValues: { searchQuery: '' },
    validators: { onChange: schoolSearchSchema },
  });

  function clearSearchTimer() {
    if (searchTimerRef.current !== undefined) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = undefined;
    }
  }

  function scheduleSearch(value: string) {
    clearSearchTimer();
    searchTimerRef.current = setTimeout(() => {
      const normalizedSearchQuery = value.trim();
      setSearchQuery(normalizedSearchQuery || undefined);
      searchTimerRef.current = undefined;
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSwitcherOpenChange(nextOpen: boolean) {
    setIsSwitcherOpen(nextOpen);
    if (nextOpen) return;

    clearSearchTimer();
    searchForm.reset();
    setSearchQuery(undefined);
  }

  const label = schoolsQuery.isPending
    ? 'Loading schools…'
    : schoolsQuery.isError
      ? 'Unable to load schools'
      : schoolsQuery.data.items.length === 0
        ? 'No schools yet'
        : selectedSchool?.name ?? 'Select a school';

  return (
    <>
      <Popover
        open={isSwitcherOpen}
        onOpenChange={handleSwitcherOpenChange}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" className="h-auto w-full min-w-0 justify-start rounded-xl p-1">
            {selectedSchool ? (
              <SchoolAvatar school={selectedSchool} />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background">
                <Building2 className="size-4" />
              </span>
            )}
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold">{label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">System administration</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command shouldFilter={false}>
            <searchForm.Field name="searchQuery">
              {(field) => (
                <>
                  <CommandInput
                    placeholder="Search schools…"
                    maxLength={200}
                    value={field.state.value}
                    aria-invalid={field.state.meta.errors.length > 0}
                    onBlur={field.handleBlur}
                    onValueChange={(value) => {
                      field.handleChange(value);
                      scheduleSearch(value);
                    }}
                  />
                  <SearchFieldErrors errors={field.state.meta.errors} />
                </>
              )}
            </searchForm.Field>
            <CommandList>
              <SchoolResultsErrorBoundary key={searchQuery ?? ''}>
                <Suspense fallback={<SchoolResultsFallback />}>
                  <SchoolResults
                    searchQuery={searchQuery}
                    selectedSchoolId={selectedSchoolId}
                    onSelect={(schoolId) => {
                      handleSwitcherOpenChange(false);
                      router.push(`/school/${schoolId}`);
                    }}
                  />
                </Suspense>
              </SchoolResultsErrorBoundary>
            </CommandList>
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  handleSwitcherOpenChange(false);
                  setIsAddSchoolOpen(true);
                }}
              >
                <Plus />
                Add school
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
      <AddSchoolDialog open={isAddSchoolOpen} onOpenChange={setIsAddSchoolOpen} />
    </>
  );
}
