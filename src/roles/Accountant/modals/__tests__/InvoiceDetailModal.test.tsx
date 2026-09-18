// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InvoiceDetailModal from '../InvoiceDetailModal';
import type { Invoice, PaymentProfile, ConveraBeneficiary, Timesheet, Project, UserProfile } from '../../../../types';

const baseInvoice: Invoice = {
  id: 1,
  invoiceNumber: 'INV-001',
  userId: 'u1',
  userName: 'Test Contractor',
  projectId: null,
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  lines: [{ weekStart: '2026-08-01', weekEndingFri: '2026-08-08', hours: 40, rate: 50, amount: 2000 }],
  totalHours: 40,
  rate: 50,
  totalAmount: 2000,
  currency: 'USD',
  status: 'submitted',
  submittedAt: '2026-09-01T00:00:00Z',
  reviewedAt: null,
  reviewedBy: null,
  notes: '',
  paymentProfile: null,
  payOnDate: null,
  paidDate: null,
  attachmentPath: null,
  paymentMethodOverride: null,
  isVendorInvoice: false,
  vendorManagerId: null,
  source: 'direct',
  createdBy: null,
  reconciliationStatus: null,
  reconciliationDelta: null,
  reconciliationNotes: null,
  groupKey: null,
  corrected: false,
  paymentTerms: null,
  qbExportStatus: 'not_exported',
  qbExportStatusAt: null,
  qbBillTxnId: null,
  matcherIgnore: false,
  editHistory: [],
};

const currentUser: UserProfile = {
  id: 'accountant-1',
  email: 'a@example.com',
  name: 'Test Accountant',
  role: 'accountant',
  country: 'US',
  region: null,
  projectId: null,
  invoiceEnabled: false,
  paymentTerms: null,
  active: true,
  isDeactivated: false,
  deactivatedAt: null,
  remindersEnabled: true,
  isTestAccount: false,
  chatEnabled: false,
  chatBotSlug: null,
  managerId: null,
  vendorManagerId: null,
  hireDate: null,
  locationType: 'onshore',
  reminderEmail: null,
  jobTitle: null,
  jobDescription: null,
  paymentEmail: null,
  invoiceCurrency: null,
  invoiceRate: null,
  attemptedPasskeyMigration: false,
} as unknown as UserProfile;

const baseProps = {
  invoice: baseInvoice,
  onClose: () => {},
  currentUser,
  users: [] as UserProfile[],
  paymentProfiles: [] as PaymentProfile[],
  converaBeneficiaries: [] as ConveraBeneficiary[],
  invoices: [baseInvoice],
  timesheets: [] as Timesheet[],
  projects: [] as Project[],
  attachmentUploading: false,
  beneficiaryOverrideProfileId: null,
  setBeneficiaryOverrideProfileId: () => {},
  beneficiaryOverrideSearch: '',
  setBeneficiaryOverrideSearch: () => {},
  paymentMethod: () => '',
  handleInvoiceAction: vi.fn(),
  saveInvoiceEdits: vi.fn(),
  savePeriodEdit: vi.fn(),
  saveValueEdit: vi.fn(),
  applyUsdRate: vi.fn(),
  previewPeriodChange: () => ({
    collisions: [],
    nextRecon: { status: 'matched', timesheetHours: 40, delta: 0 },
    willChangeLocks: false,
    toUnlock: [],
    toLock: [],
    converaMatch: undefined,
  }),
  handleAttachmentUploadForExisting: vi.fn(),
  deletePaymentProfile: vi.fn(),
  loadConveraBeneficiaries: vi.fn(),
  openAttachment: vi.fn(),
  switchInvoicePaymentProfile: vi.fn(),
  setConveraOverride: vi.fn(),
};

describe('InvoiceDetailModal — I7', () => {
  it('renders invoice number + contractor name in header', () => {
    render(<InvoiceDetailModal {...baseProps} />);
    // invoiceNumber appears in header + submitted-status Invoice Number input
    expect(screen.getAllByText('INV-001').length).toBeGreaterThan(0);
    // Contractor name renders in the header subtitle line
    expect(screen.getAllByText(/Test Contractor/).length).toBeGreaterThan(0);
  });

  it('submitted invoice renders Approve + Reject buttons', () => {
    render(<InvoiceDetailModal {...baseProps} />);
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Reject/ }).length).toBeGreaterThan(0);
  });

  it('Approve button disabled when no payment method available', () => {
    render(<InvoiceDetailModal {...baseProps} />);
    const approveBtn = screen.getByRole('button', { name: /Approve/ });
    expect(approveBtn).toBeDisabled();
  });

  it('Approve button calls handleInvoiceAction when clicked with pm', () => {
    const handleInvoiceAction = vi.fn();
    // paymentMethod returns 'Intuit' so approve is enabled
    render(<InvoiceDetailModal {...baseProps} handleInvoiceAction={handleInvoiceAction} paymentMethod={() => 'Intuit'} />);
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(handleInvoiceAction).toHaveBeenCalledWith(1, 'approved', undefined, undefined, 'Intuit', undefined);
  });

  it('Reject button calls handleInvoiceAction with rejected', () => {
    const handleInvoiceAction = vi.fn();
    render(<InvoiceDetailModal {...baseProps} handleInvoiceAction={handleInvoiceAction} paymentMethod={() => 'Intuit'} />);
    const rejectBtn = screen.getAllByRole('button', { name: /Reject/ })[0];
    fireEvent.click(rejectBtn);
    expect(handleInvoiceAction).toHaveBeenCalledWith(1, 'rejected');
  });

  it('approved invoice renders Mark as Paid panel', () => {
    render(<InvoiceDetailModal {...baseProps} invoice={{ ...baseInvoice, status: 'approved' }} />);
    expect(screen.getByText(/Mark as Paid/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirm Payment/ })).toBeInTheDocument();
  });

  it('paid invoice renders summary only (no action buttons)', () => {
    render(
      <InvoiceDetailModal
        {...baseProps}
        invoice={{ ...baseInvoice, status: 'paid', payOnDate: '2026-09-15', paidDate: '2026-09-15' }}
      />
    );
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm Payment/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-approve Invoice/ })).not.toBeInTheDocument();
    // Paid status pill visible
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('rejected invoice renders Re-approve button', () => {
    render(<InvoiceDetailModal {...baseProps} invoice={{ ...baseInvoice, status: 'rejected' }} paymentMethod={() => 'Intuit'} />);
    expect(screen.getByRole('button', { name: /Re-approve Invoice/ })).toBeInTheDocument();
  });

  it('period edit: Confirm button disabled without preview click', () => {
    render(<InvoiceDetailModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit invoice period/ }));
    // Change end date to trigger `changed`
    const inputs = screen.getAllByDisplayValue('2026-08-31');
    fireEvent.change(inputs[0], { target: { value: '2026-09-30' } });
    const reasonInputs = screen.getAllByPlaceholderText(/Parser assigned/);
    fireEvent.change(reasonInputs[0], { target: { value: 'test reason' } });
    const confirmBtn = screen.getByRole('button', { name: /Confirm change/ });
    expect(confirmBtn).toBeDisabled();
    // Click Preview — enable confirm
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(confirmBtn).not.toBeDisabled();
  });

  it('value edit: multi-line invoices show unsupported warning', () => {
    const multiLineInv: Invoice = {
      ...baseInvoice,
      lines: [
        { weekStart: '2026-08-01', weekEndingFri: '2026-08-08', hours: 20, rate: 50, amount: 1000 },
        { weekStart: '2026-08-08', weekEndingFri: '2026-08-15', hours: 20, rate: 50, amount: 1000 },
      ],
    };
    render(<InvoiceDetailModal {...baseProps} invoice={multiLineInv} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit invoice values/ }));
    expect(screen.getByText(/Multi-line invoice/)).toBeInTheDocument();
  });

  it('USD rate section only renders for non-USD imported invoices', () => {
    const eurInv: Invoice = { ...baseInvoice, source: 'imported', currency: 'EUR', rate: 40 };
    render(<InvoiceDetailModal {...baseProps} invoice={eurInv} />);
    expect(screen.getByText(/set USD rate to approve/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply USD Rate/ })).toBeInTheDocument();
  });

  it('USD rate section absent for USD invoices', () => {
    render(<InvoiceDetailModal {...baseProps} />);
    expect(screen.queryByText(/set USD rate to approve/)).not.toBeInTheDocument();
  });

  it('onClose called when clicking backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<InvoiceDetailModal {...baseProps} onClose={onClose} />);
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalled();
  });

  it('period edit save resets form state', async () => {
    const savePeriodEdit = vi.fn().mockResolvedValue(undefined);
    render(<InvoiceDetailModal {...baseProps} savePeriodEdit={savePeriodEdit} />);
    fireEvent.click(screen.getByRole('button', { name: /Edit invoice period/ }));
    const inputs = screen.getAllByDisplayValue('2026-08-31');
    fireEvent.change(inputs[0], { target: { value: '2026-09-30' } });
    const reasonInputs = screen.getAllByPlaceholderText(/Parser assigned/);
    fireEvent.change(reasonInputs[0], { target: { value: 'test reason' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm change/ }));
    // Panel collapses after save → toggle button says "Current: ..." again
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Confirm change/ })).not.toBeInTheDocument();
    });
    expect(savePeriodEdit).toHaveBeenCalled();
  });
});
