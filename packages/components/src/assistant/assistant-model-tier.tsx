import type { AssistantModelTier } from '@campuspilot/assistant-contract/dto';
import { Button } from '@campuspilot/ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '@campuspilot/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { Sparkles, Zap } from 'lucide-react';

/** What Pro costs, said wherever it can be picked. */
const PRO_COST = 'Each Pro message uses more of your school’s assistant budget.';

const TIERS: ReadonlyArray<{ value: AssistantModelTier; label: string; hint: string; icon: typeof Zap }> = [
  { value: 'standard', label: 'Fast', hint: 'Quick answers for everyday requests.', icon: Zap },
  { value: 'pro', label: 'Pro', hint: `Sharper answers: reads photos and figures more carefully. ${PRO_COST}`, icon: Sparkles },
];

const isTier = (value: string): value is AssistantModelTier => TIERS.some((tier) => tier.value === value);

/** The Fast / Pro switch in the message box's toolbar: the model that answers the next message. */
export function AssistantModelSwitch({ tier, onChange, disabled }: { tier: AssistantModelTier; onChange: (tier: AssistantModelTier) => void; disabled?: boolean }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Model"
      className="shrink-0"
      value={tier}
      disabled={disabled}
      // Clicking the picked option again would clear a single toggle group; the switch always has one.
      onValueChange={(value) => {
        if (isTier(value)) onChange(value);
      }}
    >
      {TIERS.map(({ value, label, hint, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={`${label}: ${hint}`}>
              <Icon data-icon="inline-start" aria-hidden />
              {label}
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{hint}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
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
