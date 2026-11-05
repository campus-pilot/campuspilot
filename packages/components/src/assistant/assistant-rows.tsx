import type {
  AssistantRunDto,
  AssistantToolCallItemDto,
  AssistantUserMessageItemDto,
} from '@campuspilot/assistant-contract/dto';
import { Bubble, BubbleContent } from '@campuspilot/ui/components/bubble';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@campuspilot/ui/components/collapsible';
import { Marker, MarkerContent, MarkerIcon } from '@campuspilot/ui/components/marker';
import { Message, MessageContent } from '@campuspilot/ui/components/message';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { AlertCircle, Check, ChevronRight, CircleSlash, Sparkles, X } from 'lucide-react';

import { AssistantMarkdown } from './assistant-markdown';
import { summarizeActivity } from './timeline-model';

export function AssistantUserMessage({ item }: { item: AssistantUserMessageItemDto }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end" variant="secondary">
          <BubbleContent className="whitespace-pre-wrap">{item.body.text}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** One assistant reply; `streaming` shows that more text is arriving. */
export function AssistantReply({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Message>
      <MessageContent>
        {text ? <AssistantMarkdown text={text} /> : null}
        {streaming && !text ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="size-3.5 animate-pulse" aria-hidden /> Thinking…
          </span>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function ToolStatusIcon({ status }: { status: AssistantToolCallItemDto['status'] }) {
  switch (status) {
    case 'running':
      return <Spinner className="size-3.5" />;
    case 'succeeded':
      return <Check className="size-3.5 text-emerald-600" aria-hidden />;
    case 'failed':
      return <AlertCircle className="size-3.5 text-destructive" aria-hidden />;
    case 'declined':
      return <X className="size-3.5" aria-hidden />;
    default:
      return <CircleSlash className="size-3.5" aria-hidden />;
  }
}

/** Tool calls that needed no decision, collapsed to one line (after T3 Code). */
export function AssistantActivity({ calls }: { calls: AssistantToolCallItemDto[] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
        {summarizeActivity(calls)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 flex flex-col gap-1 border-l pl-3">
          {calls.map((call) => (
            <li key={call.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ToolStatusIcon status={call.status} />
              <span className="truncate">{call.body.title}</span>
              {call.body.error ? <span className="truncate text-destructive">{call.body.error.message}</span> : null}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

const NOTICE_TEXT: Record<'failed' | 'cancelled', string> = {
  failed: 'The assistant stopped with an error.',
  cancelled: 'Stopped.',
};

/** Why a run ended early, shown where it ended. */
export function AssistantRunNotice({ run }: { run: AssistantRunDto }) {
  const status = run.status === 'cancelled' ? 'cancelled' : 'failed';
  return (
    <Marker variant="separator" className={status === 'failed' ? 'text-destructive' : undefined}>
      <MarkerIcon>{status === 'failed' ? <AlertCircle /> : <CircleSlash />}</MarkerIcon>
      <MarkerContent>{run.errorMessage ?? NOTICE_TEXT[status]}</MarkerContent>
    </Marker>
  );
}
