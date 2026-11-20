'use client';

import type { LeadDto } from '@campuspilot/api/routers/system-admin/lead/lead.dto';
import { Badge } from '@campuspilot/ui/components/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { alertStatusLabels, alertStatusVariants, answer, answerLabel, answerText } from './lead-labels';

const dateTimeFormatter = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

/** Every stored answer as key and value, in the stored JSON's key order (JSONB orders keys itself). */
function Answers({ lead }: { lead: LeadDto }) {
  return (
    <dl className="divide-y">
      {Object.entries(lead.response).map(([key, value]) => (
        <Row key={key} label={answerLabel(key)} value={answerText(value)} />
      ))}
    </dl>
  );
}

/** What happened to the lead's WhatsApp alert, and where it came from. */
function AlertFacts({ lead }: { lead: LeadDto }) {
  const sent = lead.alertSentAt ? dateTimeFormatter.format(lead.alertSentAt) : null;
  const reason = lead.alertError ?? (lead.alertHandedOverAt ? null : lead.alertLastHandoverError);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">WhatsApp alert</span>
        <Badge variant={alertStatusVariants[lead.alertStatus]}>{alertStatusLabels[lead.alertStatus]}</Badge>
      </div>
      {sent ? <p className="text-muted-foreground">Sent {sent}</p> : null}
      {reason ? <p className="text-muted-foreground">{reason}</p> : null}
      <p className="text-xs text-muted-foreground">
        {lead.form} v{lead.formVersion} · {lead.sourcePath ?? 'unknown page'} · {lead.id}
      </p>
    </div>
  );
}

/** One lead's answers and alert state. */
export function LeadDetailDialog({ lead, onClose }: { lead: LeadDto | null; onClose: () => void }) {
  return (
    <Dialog open={lead !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? (answer(lead, 'name') ?? 'Lead') : 'Lead'}</DialogTitle>
          <DialogDescription>{lead ? `Received ${dateTimeFormatter.format(lead.createdAt)}` : null}</DialogDescription>
        </DialogHeader>
        {lead ? (
          <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
            <Answers lead={lead} />
            <AlertFacts lead={lead} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
