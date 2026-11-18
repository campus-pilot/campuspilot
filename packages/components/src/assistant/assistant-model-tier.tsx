import type { AssistantModelTier } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@campuspilot/ui/components/dropdown-menu';
import { ChevronDown, Sparkles, Zap } from 'lucide-react';

/** What Pro costs, said wherever it can be picked. */
const PRO_COST = 'Uses up your school’s assistant limit faster.';

const TIERS = [
  { value: 'standard', label: 'Fast', hint: 'Quick answers for everyday requests.', cost: null, icon: Zap },
  { value: 'pro', label: 'Pro', hint: 'Sharper answers: reads photos and figures more carefully.', cost: PRO_COST, icon: Sparkles },
] as const satisfies ReadonlyArray<{ value: AssistantModelTier; label: string; hint: string; cost: string | null; icon: typeof Zap }>;

const isTier = (value: string): value is AssistantModelTier => TIERS.some((tier) => tier.value === value);

/** The model picker in the message box's toolbar: shows the model that answers the next message, and opens a menu to change it. */
export function AssistantModelSwitch({ tier, onChange, disabled }: { tier: AssistantModelTier; onChange: (tier: AssistantModelTier) => void; disabled?: boolean }) {
  const current = TIERS.find((option) => option.value === tier) ?? TIERS[0];
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" aria-label={`Model: ${current.label}`}>
          <CurrentIcon data-icon="inline-start" aria-hidden />
          {current.label}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-64">
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={tier}
          onValueChange={(value) => {
            if (isTier(value)) onChange(value);
          }}
        >
          {TIERS.map(({ value, label, hint, cost, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="items-start">
              <Icon className="mt-0.5" aria-hidden />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">{hint}</span>
                {cost ? <span className="font-medium">{cost}</span> : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A section at the top of the message box after a few messages on Fast: switch to Pro, or keep Fast. */
export function AssistantProSuggestion({ onUsePro, onDismiss }: { onUsePro: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Not happy with the answers? Try Pro.</p>
        <p className="text-xs text-muted-foreground">Pro reads photos and figures more carefully. {PRO_COST}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onUsePro}>
          <Sparkles data-icon="inline-start" aria-hidden /> Use Pro
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Keep Fast
        </Button>
      </div>
    </div>
  );
}
