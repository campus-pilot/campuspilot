import { DOCUMENT_LABELS, type DocumentType } from '@campuspilot/api/routers/school/document/document.dto';
import type { AppShellNavigationEntry, AppShellNavigationItem } from '@campuspilot/components/app-shell';
import { ArrowLeft, LayoutTemplate } from 'lucide-react';
import { marketplaceHref } from './documents/marketplace-model';
import { schoolHref } from './school-route';
import { TEMPLATE_ICONS, templateReadGate } from './settings-navigation';
import { settingsTemplateOf } from './settings-templates';

export type MarketplaceNavigationInput = {
  schoolId: string;
  /** The document types the school has templates for, in order (`marketplaceTypesOf`). */
  types: readonly DocumentType[];
  /**
   * The type being browsed: the one the address names, when the school has
   * it (`offeredTypeOf`); null on the marketplace's root or for a type the
   * school does not have.
   */
  openType: DocumentType | null;
  /**
   * The open type's designs as its catalog lists them. Empty until the
   * catalog is read, and when the user may not read it.
   */
  designs: readonly { slug: string; name: string }[];
};

/**
 * The marketplace's own sidebar, in the place of the dashboard's.
 *
 * "Back to settings" comes first, where Settings has "Back to dashboard": the
 * marketplace is reached from Settings › Templates, so it returns to the
 * settings template of the type being browsed, or to Settings while no type
 * is open. It leaves the marketplace, so it is never shown as the current
 * page.
 *
 * Then one item per type the school has, in the settings templates' order
 * and with their icons, each gated by the same read permission as its
 * settings entry. Only the open type lists its designs (`items`), so only its
 * catalog is read; following another type opens and expands that one. No
 * item marks the design the school uses: the design page's Use template
 * button says "In use".
 */
export function marketplaceNavigation({ schoolId, types, openType, designs }: MarketplaceNavigationInput): AppShellNavigationEntry[] {
  return [
    {
      type: 'item',
      id: 'back-to-settings',
      label: 'Back to settings',
      href: schoolHref(schoolId, openType ? settingsTemplateOf(openType).path : '/settings'),
      icon: ArrowLeft,
      isActive: () => false,
    },
    ...types.map((type) => marketplaceTypeItem(schoolId, type, type === openType ? designs : [])),
  ];
}

/** A type's entry; it opens the type's address, which opens its default design. */
function marketplaceTypeItem(schoolId: string, type: DocumentType, designs: readonly { slug: string; name: string }[]): AppShellNavigationItem {
  return {
    type: 'item',
    id: `marketplace-${type}`,
    label: DOCUMENT_LABELS[type],
    href: marketplaceHref(schoolId, { type }),
    icon: TEMPLATE_ICONS[type],
    wrap: templateReadGate(schoolId, settingsTemplateOf(type)),
    items: designs.map((design) => ({
      type: 'item',
      id: `marketplace-${type}-${design.slug}`,
      label: design.name,
      href: marketplaceHref(schoolId, { type, template: design.slug }),
      icon: LayoutTemplate,
    })),
  };
}
