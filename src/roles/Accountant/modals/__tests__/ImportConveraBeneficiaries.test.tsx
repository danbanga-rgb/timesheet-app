// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImportConveraBeneficiaries from '../ImportConveraBeneficiaries';
import type { PaymentProfile, ConveraBeneficiary, UserProfile } from '../../../../types';

const noop = () => {};
const fakeSyn = () => 'SYN0001';

const baseProps = {
  open: true,
  onClose: noop,
  file: null as File | null,
  onFileChange: noop,
  importing: false,
  result: null,
  paymentProfiles: [] as PaymentProfile[],
  users: [] as UserProfile[],
  converaBeneficiaries: [] as ConveraBeneficiary[],
  beneficiaryOverrideProfileId: null,
  setBeneficiaryOverrideProfileId: noop,
  beneficiaryOverrideSearch: '',
  setBeneficiaryOverrideSearch: noop,
  setConveraOverride: noop,
  computeSynVendorCode: fakeSyn,
  onImport: noop,
};

const offshoreProfile = (id: number, extras: Partial<PaymentProfile> = {}): PaymentProfile => ({
  id,
  userId: `user-${id}`,
  profileName: `Profile ${id}`,
  companyName: `Company ${id}`,
  companyAddress: 'Addr',
  country: 'RS',
  bankName: 'Bank',
  bankAddress: '',
  bankBranch: '',
  accountNumber: '',
  iban: `RS35123456789012345${id}`,
  swift: 'BANKRS22',
  paymentEmail: '',
  isDefault: false,
  converaBeneficiaryId: null,
  ...extras,
});

const offshoreUser = (id: string): UserProfile => ({
  id,
  email: `u${id}@ex.com`,
  name: `User ${id}`,
  role: 'timesheetuser',
  managerId: null,
  country: 'RS',
  region: '',
  projectId: null,
  locationType: 'offshore',
});

describe('ImportConveraBeneficiaries (M0)', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<ImportConveraBeneficiaries {...baseProps} open={false} />);
    expect(container.textContent).toBe('');
  });

  it('renders title + upload card when open', () => {
    render(<ImportConveraBeneficiaries {...baseProps} />);
    expect(screen.getByText('Import Beneficiaries')).toBeInTheDocument();
    expect(screen.getByText(/Click to select beneficiaries XLS/)).toBeInTheDocument();
  });

  it('awaiting-setup panel shows offshore profiles without a Convera link', () => {
    const p = offshoreProfile(1);
    render(<ImportConveraBeneficiaries {...baseProps} paymentProfiles={[p]} users={[offshoreUser('user-1')]} />);
    expect(screen.getByText(/Awaiting Convera setup/)).toBeInTheDocument();
    expect(screen.getByText('User user-1')).toBeInTheDocument();
    expect(screen.getByText('SYN0001')).toBeInTheDocument();
  });

  it('awaiting-setup panel hidden when all profiles already linked / US / onshore', () => {
    const linked = offshoreProfile(1, { converaBeneficiaryId: 42 });
    const us = offshoreProfile(2, { country: 'US' });
    render(<ImportConveraBeneficiaries {...baseProps} paymentProfiles={[linked, us]} users={[offshoreUser('user-1'), offshoreUser('user-2')]} />);
    expect(screen.queryByText(/Awaiting Convera setup/)).toBeNull();
  });

  it('Import & Match button disabled without file', () => {
    render(<ImportConveraBeneficiaries {...baseProps} />);
    expect(screen.getByRole('button', { name: /Import & Match/ })).toBeDisabled();
  });

  it('Import & Match click passes file to onImport', () => {
    const onImport = vi.fn();
    const fakeFile = new File(['x'], 'bene.xls');
    render(<ImportConveraBeneficiaries {...baseProps} file={fakeFile} onImport={onImport} />);
    fireEvent.click(screen.getByRole('button', { name: /Import & Match/ }));
    expect(onImport).toHaveBeenCalledWith(fakeFile);
  });

  it('unmatched row → Link manually opens the picker', () => {
    const setOverride = vi.fn();
    const result = {
      imported: 5,
      matched: 3,
      unmatched: [{ profileId: 99, userId: 'user-99', userName: 'Unmatched User' }],
    };
    render(<ImportConveraBeneficiaries {...baseProps} result={result} setBeneficiaryOverrideProfileId={setOverride} />);
    expect(screen.getByText('Unmatched User')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Link manually/ }));
    expect(setOverride).toHaveBeenCalledWith(99);
  });
});
