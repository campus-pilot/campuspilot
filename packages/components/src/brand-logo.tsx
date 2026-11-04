import type { SVGProps } from 'react';

const MARK_SIZE_CLASSES = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;

export type BrandLogoSize = keyof typeof MARK_SIZE_CLASSES;

/**
 * Which CampusPilot product the logo represents. Each product has its own emblem inside
 * the shared open C, and callers must name it explicitly.
 */
export type BrandProduct = 'campuspilot' | 'admin';

const PRODUCT_LABELS: Record<BrandProduct, { name: string; suffix?: string }> = {
  campuspilot: { name: 'CampusPilot' },
  admin: { name: 'CampusPilot', suffix: 'Admin' },
};

/** CampusPilot emblem: a graduation cap centred inside the C. */
function CapEmblem() {
  return (
    <>
      <path d="M34.5 21.5 49 28 34.5 34.5 20 28Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M26.5 35 34.5 39 42.5 35V40C42.5 42 39 44 34.5 44S26.5 42 26.5 40Z" fill="currentColor" />
      <path d="M46.5 29V37.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  );
}

/** Admin emblem: a classical administration building centred inside the C. */
function BuildingEmblem() {
  return (
    <>
      <path d="M24.5 27.75 34.5 21.25 44.5 27.75Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <g fill="currentColor">
        <rect x="26" y="29.75" width="4" height="9" rx="1" />
        <rect x="32.5" y="29.75" width="4" height="9" rx="1" />
        <rect x="39" y="29.75" width="4" height="9" rx="1" />
        <rect x="24.5" y="40.25" width="20" height="3.5" rx="1.75" />
      </g>
    </>
  );
}

/**
 * The bare brand mark as an inline SVG. It draws in `currentColor`, so it is near-black on
 * light surfaces and white on dark ones by following the text colour. The geometry matches
 * the files in the repository's root `brand/` folder; change both together.
 */
export function BrandGlyph({ product, ...props }: { product: BrandProduct } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" {...props}>
      <path d="M51.35 17.86A22 22 0 1 0 51.35 46.14" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {product === 'admin' ? <BuildingEmblem /> : <CapEmblem />}
    </svg>
  );
}

/** Icon-only variant of the brand mark. */
export function BrandMark({ product, size = 'md', className }: { product: BrandProduct; size?: BrandLogoSize; className?: string }) {
  return <BrandGlyph product={product} className={`shrink-0 text-foreground ${MARK_SIZE_CLASSES[size]} ${className ?? ''}`} />;
}

/** Icon + wordmark variant of the brand mark. The admin product appends a lighter "Admin" label. */
export function BrandLogo({ product, size = 'md', className }: { product: BrandProduct; size?: BrandLogoSize; className?: string }) {
  const label = PRODUCT_LABELS[product];

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <BrandMark product={product} size={size} />
      <span className="flex items-baseline gap-1 text-sm tracking-tight text-foreground">
        <span className="font-semibold">{label.name}</span>
        {label.suffix ? <span className="text-muted-foreground">{label.suffix}</span> : null}
      </span>
    </div>
  );
}
