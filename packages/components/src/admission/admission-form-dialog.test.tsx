// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdmissionFormDialog } from './admission-form-dialog';
import type { AdmissionFormValue } from './types';

const empty: AdmissionFormValue = {
  name: '', admissionNo: '', admissionClassId: null, address: '', phoneNo: '',
  whatsappNo: null, whatsappSameAsPhone: true, whatsappVerified: false, whatsappConsent: false,
  email: null, dob: '', fatherName: '', motherName: '',
};

function renderDialog(defaultValues: AdmissionFormValue = empty, mode: 'create' | 'edit' = 'create') {
  const onSubmit = vi.fn(async () => undefined);
  render(<AdmissionFormDialog open mode={mode} defaultValues={defaultValues} classes={[]} onOpenChange={() => undefined} onSubmit={onSubmit} />);
  return onSubmit;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillDetails() {
  type('Student name', 'Asha Kumari');
  type('Admission number', 'ADM-1');
  type('Date of birth', '2016-04-01');
  type("Father's name", 'Ravi Kumar');
  type("Mother's name", 'Meena Kumari');
  type('Address', 'Main road');
}

// Radix Select/Checkbox measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => cleanup());

describe('AdmissionFormDialog (stepper)', () => {
  it('validates the details step before moving on', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Student name is required.')).toBeTruthy();
    expect(screen.queryByLabelText('Phone number')).toBeNull();

    fillDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Phone number')).toBeTruthy();
  });

  it('defaults to the phone as WhatsApp number, verified, and submits E.164', async () => {
    const onSubmit = renderDialog();
    fillDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const same = await screen.findByRole('checkbox', { name: 'WhatsApp number is the same as phone number' });
    expect(same.getAttribute('aria-checked') ?? String((same as HTMLInputElement).checked)).toBe('true');
    expect((screen.getByLabelText('WhatsApp number') as HTMLInputElement).disabled).toBe(true);

    type('Phone number', '98765 43210');
    expect((screen.getByLabelText('WhatsApp number') as HTMLInputElement).value).toBe('98765 43210');
    fireEvent.click(screen.getByRole('button', { name: 'Create admission' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Asha Kumari',
        phoneNo: '+919876543210',
        whatsappSameAsPhone: true,
        whatsappNo: '+919876543210',
        whatsappVerified: true,
        whatsappConsent: false,
        email: null,
      }),
      { generateCadetPassword: false },
    );
  });

  it('keeps typed details when going back, and asks for a valid separate WhatsApp number', async () => {
    const onSubmit = renderDialog();
    fillDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('Phone number');
    type('Phone number', '9876543210');
    fireEvent.click(screen.getByRole('checkbox', { name: 'WhatsApp number is the same as phone number' }));
    const whatsapp = screen.getByLabelText('WhatsApp number') as HTMLInputElement;
    expect(whatsapp.disabled).toBe(false);
    type('WhatsApp number', '123');
    fireEvent.click(screen.getByRole('button', { name: 'Create admission' }));
    expect(await screen.findByText('Enter a valid WhatsApp number for the selected country.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((screen.getByLabelText('Student name') as HTMLInputElement).value).toBe('Asha Kumari');
  });

  it('shows an unmigrated phone value as stored for correction when editing', async () => {
    renderDialog({ ...empty, name: 'Old', admissionNo: 'A-1', dob: '2015-01-01', fatherName: 'F', motherName: 'M', address: 'X', phoneNo: '+91 ask at office', whatsappSameAsPhone: false }, 'edit');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(((await screen.findByLabelText('Phone number')) as HTMLInputElement).value).toBe('+91 ask at office');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a valid phone number for the selected country.')).toBeTruthy();
  });
});
