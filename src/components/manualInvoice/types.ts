// Manual Invoice types — shared across the Manual Invoice modal + payee picker + payee panel.

export interface PayeeCandidate {
  userId: string;
  name: string;
  email: string;
  role: string;
  section: 'one-off' | 'contractor-no-invoice' | 'other';
  hasDefaultProfile: boolean;
  defaultPaymentMethod: string | null;  // 'Intuit' | 'Convera' | null
  currency: string | null;
  countryCode: string | null;
}

export interface OneOffPayeeDraft {
  name: string;
  email: string;              // required by profiles_email_format; auto-generated if blank
  iban: string;
  swift: string;
  bankName: string;
  countryCode: string;         // ISO alpha-2
  paymentMethod: 'Intuit' | 'Convera';
  qbVendorName: string;        // optional; can set later in Payment Profiles tab
  currency: string;            // default 'USD'
}
