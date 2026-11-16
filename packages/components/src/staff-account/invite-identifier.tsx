'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@campuspilot/ui/components/tabs';
import { z } from 'zod';

import {
  phoneInputValueFromStored,
  phoneInputValueSchema,
  phoneInputValueToE164,
  type PhoneInputValue,
} from '../phone-input';

/** How an invitation names the person: their email or their phone number. */
export type InviteMethod = 'email' | 'phone';

/** Form values for the identifier part of a staff invitation. */
export type InviteIdentifierValues = {
  method: InviteMethod;
  email: string;
  phone: PhoneInputValue;
};

export function defaultInviteIdentifierValues(): InviteIdentifierValues {
  return { method: 'email', email: '', phone: phoneInputValueFromStored(null) };
}

/** Zod shape for the identifier fields; pair with {@link refineInviteIdentifier}. */
export const inviteIdentifierShape = {
  method: z.enum(['email', 'phone']),
  email: z.string(),
  phone: phoneInputValueSchema,
};

/**
 * Validates only the field the chosen method uses, so a half-typed value in
 * the other tab never blocks submitting. The server validates again.
 */
export function refineInviteIdentifier(value: InviteIdentifierValues, context: z.RefinementCtx) {
  if (value.method === 'email') {
    if (!z.email().safeParse(value.email.trim()).success) {
      context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address.' });
    }
    return;
  }
  if (!value.phone.number.trim()) {
    context.addIssue({ code: 'custom', path: ['phone'], message: 'Phone number is required.' });
  } else if (!phoneInputValueToE164(value.phone)) {
    context.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number for the selected country.' });
  }
}

/** The `inviteMember` identifier for validated values: exactly one of the two. */
export function inviteIdentifierInput(value: InviteIdentifierValues): { email: string } | { phoneNumber: string } {
  return value.method === 'email'
    ? { email: value.email.trim() }
    : { phoneNumber: phoneInputValueToE164(value.phone) ?? '' };
}

/**
 * Email / Phone number tabs for an invitation. Controlled: the caller's form
 * owns the method and renders each tab's field. Without `allowPhone` (the
 * caller may not issue passwords) only the email field is shown.
 */
export function InviteIdentifierTabs({
  method,
  allowPhone,
  onMethodChange,
  email,
  phone,
}: {
  method: InviteMethod;
  allowPhone: boolean;
  onMethodChange: (method: InviteMethod) => void;
  email: ReactNode;
  phone: ReactNode;
}) {
  if (!allowPhone) return email;
  return (
    <Tabs value={method} onValueChange={(next) => onMethodChange(next as InviteMethod)} className="gap-3">
      <TabsList>
        <TabsTrigger value="email">Email</TabsTrigger>
        <TabsTrigger value="phone">Phone number</TabsTrigger>
      </TabsList>
      <TabsContent value="email">{email}</TabsContent>
      <TabsContent value="phone">
        <div className="flex flex-col gap-2">
          {phone}
          <p className="text-xs text-muted-foreground">
            A password is created for them and shown to you once. They sign in with this number and that password.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
