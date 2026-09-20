'use client';

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@campuspilot/ui/components/alert';
import { Badge } from '@campuspilot/ui/components/badge';
import { Label } from '@campuspilot/ui/components/label';
import { Switch } from '@campuspilot/ui/components/switch';
import { CalendarCheck, Sparkles } from 'lucide-react';

export interface AttendanceSectionProps {
  enabled: boolean;
  onChange?: (enabled: boolean) => void;
}

export function AttendanceSection({
  enabled,
  onChange,
}: AttendanceSectionProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Attendance
        </h2>
        <p className="text-xs text-muted-foreground">
          This will allow teachers to put attendance while result generation
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
            <CalendarCheck className="size-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={onChange ? 'attendance-toggle' : undefined} className="font-medium">
              Enable session attendance entry
            </Label>
            <span className="text-[11px] text-muted-foreground">
              Teachers will be prompted to record student attendance during
              result entry
            </span>
          </div>
        </div>
        {onChange ? <Switch
          id="attendance-toggle"
          checked={enabled}
          onCheckedChange={onChange}
        /> : <Badge variant="outline">{enabled ? 'Enabled' : 'Disabled'}</Badge>}
      </div>

      <Alert>
        <Sparkles className="size-4" />
        <AlertTitle className="flex items-center gap-2">
          <span>Student and Staff Attendance tracker</span>
          <Badge
            variant="secondary"
            className="bg-amber-500/15 text-amber-600 dark:text-amber-400"
          >
            Coming soon!!
          </Badge>
        </AlertTitle>
        <AlertDescription>
          Daily student and staff attendance logging, automated leave requests,
          and parent notification alerts are in active development and will be
          integrated into upcoming updates.
        </AlertDescription>
      </Alert>
    </div>
  );
}
