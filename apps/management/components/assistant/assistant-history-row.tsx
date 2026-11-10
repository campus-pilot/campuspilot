'use client';

import type { AssistantConversationDto } from '@campuspilot/assistant-contract/dto';
import { AssistantAttentionDot } from '@campuspilot/components/assistant';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { toast } from '@campuspilot/ui/lib/toast';
import { cn } from '@campuspilot/ui/lib/utils';
import { useForm } from '@tanstack/react-form';
import { Ellipsis, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { refusalMessage } from './assistant-stream';
import { useDeleteAssistantConversation } from './use-assistant';

const titleOf = (conversation: Pick<AssistantConversationDto, 'title'>) => conversation.title ?? 'Untitled conversation';

/** "now", "5m", "3h", "2d": compact, like a thread list. */
function relativeAge(at: Date): string {
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : relativeFormat.format(-Math.round(days / 7), 'week');
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });

/**
 * Brings the open conversation's row into view when it appears: on phones
 * the history is a sideways strip, and the open one may be off to the right.
 * A row that is already fully in view is left where it is, so the strip
 * does not shift for nothing. A stable function, so React calls it only
 * when a row becomes the open one (not on every render), and it never
 * fights the user's own scrolling.
 */
function bringIntoView(row: HTMLElement | null) {
  const list = row?.closest('nav');
  if (!row || !list) return;
  const [inner, outer] = [row.getBoundingClientRect(), list.getBoundingClientRect()];
  const visible = inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
  if (!visible) row.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/**
 * Why a conversation cannot be deleted right now, in the service's own
 * words; null when it can. The service refuses while a run has not
 * finished, which is exactly when the row says it is working or waiting.
 */
const deleteBlockedReason = (conversation: AssistantConversationDto) =>
  conversation.attention === 'working' || conversation.attention === 'approval'
    ? 'Stop the assistant before deleting this conversation.'
    : null;

/**
 * The row's "…" menu. In the desktop column it takes the place of the age
 * while the row is hovered, focused or its menu is open (always on touch
 * screens, which cannot hover). In the phone strip only the open
 * conversation shows it, so the strip stays a row of titles.
 */
function ConversationMenu({
  conversation,
  active,
  onDelete,
}: {
  conversation: AssistantConversationDto;
  active: boolean;
  onDelete: (conversation: AssistantConversationDto) => void;
}) {
  const blocked = deleteBlockedReason(conversation);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Conversation actions"
          className={cn(
            'shrink-0 text-muted-foreground hover:text-foreground max-md:me-1 md:absolute md:end-1 md:opacity-0 md:group-hover/conversation:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100 md:pointer-coarse:opacity-100',
            !active && 'max-md:hidden',
          )}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem variant="destructive" disabled={Boolean(blocked)} onSelect={() => onDelete(conversation)}>
          <Trash2 /> Delete
        </DropdownMenuItem>
        {blocked ? <p className="max-w-48 px-2 pb-1.5 text-xs text-muted-foreground">{blocked}</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One conversation in the history: a dot when it needs noticing, its title,
 * its age, and its menu. The row's surface (hover, selected) is the wrapper,
 * so the link and the menu button sit side by side inside it rather than a
 * button inside a link.
 */
export function ConversationRow({
  href,
  conversation,
  active,
  onDelete,
}: {
  href: string;
  conversation: AssistantConversationDto;
  active: boolean;
  onDelete: (conversation: AssistantConversationDto) => void;
}) {
  return (
    <div
      ref={active ? bringIntoView : undefined}
      className={cn(
        // On phones a title is capped, so the strip shows several conversations instead of one long title.
        // The hover look also holds while the row's menu is open, so the menu visibly belongs to its row.
        'group/conversation relative flex h-8 shrink-0 items-center rounded-lg text-[13px] text-muted-foreground transition-colors hover:text-foreground hover:assistant-ghost-hover has-data-[state=open]:text-foreground has-data-[state=open]:assistant-ghost-hover max-md:max-w-48 md:shrink',
        active && 'font-medium text-foreground assistant-selected hover:assistant-selected',
      )}
    >
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
      >
        <AssistantAttentionDot attention={conversation.attention} />
        <span className="min-w-0 flex-1 truncate">{titleOf(conversation)}</span>
        {/* The age gives its place to the menu button while that shows; it keeps its width, so the title does not move. */}
        <time
          className="hidden shrink-0 text-xs font-normal text-assistant-dim tabular-nums md:block md:group-hover/conversation:invisible md:group-focus-within/conversation:invisible md:group-has-data-[state=open]/conversation:invisible md:pointer-coarse:invisible"
          dateTime={conversation.updatedAt.toISOString()}
        >
          {relativeAge(conversation.updatedAt)}
        </time>
      </Link>
      <ConversationMenu conversation={conversation} active={active} onDelete={onDelete} />
    </div>
  );
}

/**
 * Deleting a conversation, confirmed in the app's dialog. The form holds
 * which conversation is being confirmed (`target`) and the last failure;
 * submitting it is the deletion, so the dialog's progress and its
 * dismissal come from the form's own submission state.
 */
export function useDeleteConversation(schoolId: string, onDeleted: (conversationId: string) => void) {
  const remove = useDeleteAssistantConversation(schoolId);
  const form = useForm({
    defaultValues: { target: null as AssistantConversationDto | null, error: '' },
    onSubmit: async ({ value, formApi }) => {
      const target = value.target;
      if (!target) return;
      formApi.setFieldValue('error', '');
      try {
        await remove.mutateAsync({ schoolId, conversationId: target.id });
      } catch (error) {
        formApi.setFieldValue('error', refusalMessage(error) ?? 'The conversation could not be deleted. Check your connection and try again.');
        return;
      }
      formApi.reset();
      toast.success('Conversation deleted.');
      onDeleted(target.id);
    },
  });
  return {
    form,
    /** Opens the confirmation for a conversation, clear of any earlier failure. */
    ask: (conversation: AssistantConversationDto) => {
      form.setFieldValue('error', '');
      form.setFieldValue('target', conversation);
    },
  };
}

/** The confirmation for `useDeleteConversation`: it names the conversation and says what goes with it. */
export function DeleteConversationDialog({ form }: Pick<ReturnType<typeof useDeleteConversation>, 'form'>) {
  return (
    <form.Subscribe selector={(state) => ({ ...state.values, submitting: state.isSubmitting })}>
      {({ target, error, submitting }) => (
        <ConfirmationDialog
          open={Boolean(target)}
          title="Delete this conversation?"
          description={`“${target ? titleOf(target) : ''}” and everything in it will be deleted for good. Changes the assistant already made to school data are kept.`}
          confirmLabel={submitting ? 'Deleting…' : 'Delete conversation'}
          pending={submitting}
          onOpenChange={(open) => {
            if (!open) form.reset();
          }}
          onConfirm={() => void form.handleSubmit()}
        >
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </ConfirmationDialog>
      )}
    </form.Subscribe>
  );
}
