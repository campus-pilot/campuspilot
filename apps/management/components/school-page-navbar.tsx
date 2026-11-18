import { BrandLogo } from '@campuspilot/components/brand-logo';
import { ManagementAccountMenu } from '@/components/management-account-menu';

/** The bar of the pages outside any school: the school entry page and creating a school. */
export function SchoolPageNavbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-5 sm:px-8">
      <BrandLogo product="campuspilot" size="sm" />
      <ManagementAccountMenu />
    </header>
  );
}
