import { AvatarFallback } from '@campuspilot/ui/components/avatar';
import { UserRound } from 'lucide-react';
import { staffInitials, type StaffSignInIdentity } from './staff-sign-in-label';

/**
 * Avatar fallback for a staff member: their initials, or a person icon for
 * an unnamed phone-only account (a number has no letters to use).
 */
export function StaffAvatarFallback({ person }: { person: StaffSignInIdentity & { name: string } }) {
  return <AvatarFallback>{staffInitials(person) ?? <UserRound aria-hidden />}</AvatarFallback>;
}
