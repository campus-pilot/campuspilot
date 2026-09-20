import { GraduationCap } from 'lucide-react';

const BOX_SIZE_CLASSES = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;
const ICON_SIZE_CLASSES = { sm: 'size-4', md: 'size-5', lg: 'size-6' } as const;

export type BrandLogoSize = keyof typeof BOX_SIZE_CLASSES;

/**
 * The mark's background always tracks `--foreground`, so it flips with the
 * app's light/dark theme automatically — no theme prop needed.
 */
function BrandIcon({ size = 'md', className }: { size?: BrandLogoSize; className?: string }) {
  return (
    <span
      className={`grid ${BOX_SIZE_CLASSES[size]} place-items-center rounded-xl bg-foreground text-background shadow-sm ${className ?? ''}`}
    >
      <GraduationCap className={ICON_SIZE_CLASSES[size]} aria-hidden="true" />
    </span>
  );
}

/** Icon-only variant of the brand mark. */
export function BrandMark({ size = 'md', className }: { size?: BrandLogoSize; className?: string }) {
  return <BrandIcon size={size} className={className} />;
}

/** Icon + wordmark variant of the brand mark. */
export function BrandLogo({ size = 'md', className }: { size?: BrandLogoSize; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <BrandIcon size={size} />
      <span className="text-sm font-semibold tracking-tight text-foreground">CampusPilot</span>
    </div>
  );
}
