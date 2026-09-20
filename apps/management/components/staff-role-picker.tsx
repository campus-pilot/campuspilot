'use client';

import {
  roleEnum,
  type Role,
} from '@campuspilot/api/routers/school/member/member.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Label } from '@campuspilot/ui/components/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@campuspilot/ui/components/popover';
import { ChevronDown } from 'lucide-react';

export const roleLabels: Record<Role, string> = {
  principal: 'Principal',
  teacher: 'Teacher',
  accountant: 'Accountant',
  exam_coordinator: 'Exam coordinator',
  manager: 'Manager',
};

export function StaffRolePicker({
  id,
  roles,
  onChange,
  invalid,
}: {
  id: string;
  roles: Role[];
  onChange: (roles: Role[]) => void;
  invalid?: boolean;
}) {
  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {roles.length === 0
              ? 'Select roles'
              : roles.map((role) => roleLabels[role]).join(', ')}
          </span>
          <ChevronDown className="shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 gap-1 p-2"
      >
        {roleEnum.options.map((role) => (
          <Label
            key={role}
            htmlFor={`${id}-${role}`}
            className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 font-normal hover:bg-accent"
          >
            <Checkbox
              id={`${id}-${role}`}
              checked={roles.includes(role)}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...roles, role]
                    : roles.filter((value) => value !== role),
                )
              }
            />
            {roleLabels[role]}
          </Label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
