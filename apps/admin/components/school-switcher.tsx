'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
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

function schoolIdFromPath(pathname: string): string | undefined {
  const match = /^\/school\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function SchoolSwitcher() {
  const [isAddSchoolOpen, setIsAddSchoolOpen] = useState(false);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const schoolsQuery = useQuery(orpc.systemAdmin.getSchools.queryOptions());
  const selectedSchoolId = schoolIdFromPath(pathname);
  const selectedSchool = schoolsQuery.data?.find((school) => school.id === selectedSchoolId);

  const label = schoolsQuery.isPending
    ? 'Loading schools…'
    : schoolsQuery.isError
      ? 'Unable to load schools'
      : schoolsQuery.data.length === 0
        ? 'No schools yet'
        : selectedSchool?.name ?? 'Select a school';

  return (
    <>
      <Popover
        open={isSwitcherOpen}
        onOpenChange={setIsSwitcherOpen}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" className="h-auto w-full min-w-0 justify-start rounded-xl p-1">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-foreground text-background">
              <Building2 className="size-4" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-semibold">{label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">System administration</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search schools…" />
            <CommandList>
              <CommandEmpty>No schools match your search.</CommandEmpty>
              <CommandGroup heading="Schools">
                {schoolsQuery.isPending ? (
                  <CommandItem disabled forceMount>Loading schools…</CommandItem>
                ) : null}
                {schoolsQuery.isError ? (
                  <CommandItem disabled forceMount>Schools could not be loaded</CommandItem>
                ) : null}
                {schoolsQuery.data?.map((school) => (
                  <CommandItem
                    key={school.id}
                    value={`${school.name} ${school.slug} ${school.location}`}
                    data-checked={school.id === selectedSchoolId}
                    onSelect={() => {
                      setIsSwitcherOpen(false);
                      router.push(`/school/${school.id}`);
                    }}
                  >
                    <Building2 />
                    <span className="truncate">{school.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  setIsSwitcherOpen(false);
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
