// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PaymentProfileModal from '../PaymentProfileModal';
import type { ProfileForm, PaymentProfile } from '../../types';

function emptyForm(): ProfileForm {
  return {
    profileName: '', companyName: '', companyAddress: '', country: '',
    bankName: '', bankAddress: '', bankBranch: '', accountNumber: '',
    iban: '', swift: '', paymentEmail: '', isDefault: false,
    combinePayments: null, converaBeneficiaryId: null, converaMatchOverride: false,
    qbVendorName: null,
  };
}

describe('PaymentProfileModal (PP3)', () => {
  it('renders nothing when open=false', () => {
    render(
      <PaymentProfileModal
        open={false}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText('New Payment Profile')).toBeNull();
    expect(screen.queryByText('Edit Payment Profile')).toBeNull();
  });

  it('mode=full renders 13 inputs + 2 section headers', () => {
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/Company Details \(as per bank account\)/)).toBeInTheDocument();
    expect(screen.getByText(/Bank Details/)).toBeInTheDocument();
    // 12 <input> + 1 <textarea> + 1 <select> (country) = 13 form controls; isDefault checkbox is a 14th <input>
    // Count fields by label presence rather than element type to lock behavior semantically.
    expect(screen.getByText(/Profile Label \*/)).toBeInTheDocument();
    expect(screen.getByText(/Full Company Name \*/)).toBeInTheDocument();
    expect(screen.getByText(/Company Address/)).toBeInTheDocument();
    expect(screen.getByText(/Country/)).toBeInTheDocument();
    expect(screen.getByText(/Bank Name \*/)).toBeInTheDocument();
    expect(screen.getByText(/Bank Address/)).toBeInTheDocument();
    expect(screen.getByText(/Bank Branch/)).toBeInTheDocument();
    expect(screen.getByText(/Account Number \*/)).toBeInTheDocument();
    expect(screen.getByText(/^IBAN$/)).toBeInTheDocument();
    expect(screen.getByText(/SWIFT \/ BIC \*/)).toBeInTheDocument();
    expect(screen.getByText(/Email Address for Payment Notification/)).toBeInTheDocument();
    expect(screen.getByText(/Set as default payment profile/)).toBeInTheDocument();
  });

  it('mode=basic renders 6 inputs + no section headers + teal accent', () => {
    render(
      <PaymentProfileModal
        open={true}
        mode="basic"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    // Section headers hidden
    expect(screen.queryByText(/Company Details \(as per bank account\)/)).toBeNull();
    expect(screen.queryByText(/^Bank Details$/)).toBeNull();
    // Basic-mode fields present
    expect(screen.getByText(/Profile Label \*/)).toBeInTheDocument();
    expect(screen.getByText(/Company Name \*/)).toBeInTheDocument();
    expect(screen.getByText(/Bank Name \*/)).toBeInTheDocument();
    expect(screen.getByText(/Account Number \*/)).toBeInTheDocument();
    expect(screen.getByText(/^IBAN$/)).toBeInTheDocument();
    expect(screen.getByText(/SWIFT \/ BIC \*/)).toBeInTheDocument();
    // Basic-mode fields hidden
    expect(screen.queryByText(/Company Address/)).toBeNull();
    expect(screen.queryByText(/^Country$/)).toBeNull();
    expect(screen.queryByText(/Bank Address/)).toBeNull();
    expect(screen.queryByText(/Bank Branch/)).toBeNull();
    expect(screen.queryByText(/Email Address for Payment Notification/)).toBeNull();
    // Teal accent on save button
    const save = screen.getByRole('button', { name: /Save Profile/i });
    expect(save.className).toMatch(/bg-teal-600/);
  });

  it('editingProfile null → "New Payment Profile" heading; set → "Edit Payment Profile"', () => {
    const { unmount } = render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('New Payment Profile')).toBeInTheDocument();
    unmount();

    const editing: PaymentProfile = { ...emptyForm(), id: 42, userId: 'u1' };
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={editing}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Edit Payment Profile')).toBeInTheDocument();
  });

  it('typing in Profile Label calls setForm with the new value', () => {
    const setForm = vi.fn();
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={setForm}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    const label = screen.getByPlaceholderText(/My UK Account, US Corp Account/i);
    fireEvent.change(label, { target: { value: 'Vendor US' } });
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ profileName: 'Vendor US' }));
  });

  it('IBAN input uppercases on change (full mode)', () => {
    const setForm = vi.fn();
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={setForm}
        editingProfile={null}
        onSave={() => {}}
        onCancel={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/GB29 NWBK/i), { target: { value: 'gb29nwbk' } });
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ iban: 'GB29NWBK' }));
  });

  it('click Save Profile calls onSave', () => {
    const onSave = vi.fn();
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={onSave}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save Profile/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('click Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <PaymentProfileModal
        open={true}
        mode="full"
        form={emptyForm()}
        setForm={() => {}}
        editingProfile={null}
        onSave={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
