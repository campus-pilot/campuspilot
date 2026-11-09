import {
  NOTIFICATION_TYPES,
  notificationCatalogue,
  notificationPayloadSchemas,
  notificationTypesFor,
  type AdmissionNotificationType,
  type NotificationType,
  type StaffNotificationType,
} from '@campuspilot/db/notifications/catalogue';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { notificationChannelAdapters } from './channels';
import { notificationDeliveryId, notificationRowId } from './ids';

describe('notification catalogue', () => {
  it('is exhaustive at the type level: a Record over the types must name every type', () => {
    // Every consumer is a Record<NotificationType, …>; leaving a type out is a build error.
    // @ts-expect-error `bill.issued` and the other types are missing.
    const incomplete: Record<NotificationType, true> = { 'billing.run_posted': true };
    expect(incomplete).toBeDefined();
    expectTypeOf<keyof typeof notificationPayloadSchemas>().toEqualTypeOf<NotificationType>();
    expectTypeOf<keyof typeof notificationCatalogue>().toEqualTypeOf<NotificationType>();
    expectTypeOf<AdmissionNotificationType | StaffNotificationType>().toEqualTypeOf<NotificationType>();
    expectTypeOf<Extract<AdmissionNotificationType, StaffNotificationType>>().toEqualTypeOf<never>();
  });

  it('lists every type once with an audience, a payload schema and the in-app channel', () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
    expect(Object.keys(notificationPayloadSchemas).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    for (const type of NOTIFICATION_TYPES) {
      const entry = notificationCatalogue[type];
      expect(entry.channels, type).toContain('in_app');
      if (entry.audience === 'staff_user') expect(entry.channels, type).toEqual(['in_app']);
    }
    expect([...notificationTypesFor('admission'), ...notificationTypesFor('staff_user')].sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('has an adapter for every remote channel, all switched off by default (test env sets no kill switch)', () => {
    expect(Object.values(notificationChannelAdapters).every((adapter) => !adapter.available)).toBe(true);
  });

  it('derives stable, prefix-formatted row IDs that differ per recipient kind and channel', () => {
    const a = notificationRowId('nev_x', { kind: 'staff_user', id: 'u1' });
    expect(a).toMatch(/^ntf_[a-f0-9]{21}$/);
    expect(notificationRowId('nev_x', { kind: 'staff_user', id: 'u1' })).toBe(a);
    expect(notificationRowId('nev_x', { kind: 'admission', id: 'u1' })).not.toBe(a);
    expect(notificationRowId('nev_y', { kind: 'staff_user', id: 'u1' })).not.toBe(a);
    expect(notificationDeliveryId(a, 'whatsapp', null)).toMatch(/^ndl_[a-f0-9]{21}$/);
    expect(notificationDeliveryId(a, 'whatsapp', null)).not.toBe(notificationDeliveryId(a, 'web_push', null));
  });
});
