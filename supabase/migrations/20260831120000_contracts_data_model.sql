-- Slice 1: Data model for contracts pre-onboarding arc.
-- Fill-then-sign architecture: Contract Admin fills variables in UI,
-- generate-contract edge fn merges DOCX, send-to-docuseal handles signatures only.
-- Full context: .claude/plans/contracts-preonboarding.md
--
-- Tables (dependency order):
--   1. organizations         — multi-tenant scaffolding (single row for MVP)
--   2. tenant_config         — Synergie signer/initiator/cc identity
--   3. counterparties        — vendor entities (individual + umbrella patterns)
--   4. role_descriptions     — reusable library populated at SOW send time
--   5. contracts             — MSA-style Vendor Consulting Agreements
--   6. sows                  — Schedule of Work (embedded initial + standalone)
--   7. contract_documents    — additional signable docs (NDA/IP/etc.) [MVP2 use]
--   8. docuseal_webhook_events — lean append-only audit log for forensics + idempotency
--
-- Existing table changes:
--   - profiles.role: add 'contract_admin' to CHECK constraint
--   - payment_profiles: add counterparty_id (for umbrella-payment cases)
--
-- All new tables carry organization_id defaulted to Synergie's fixed UUID.
-- Per [[rls-on-new-tables]]: every table gets policies.
-- Per [[no-hardcoded-synergie]]: Synergie strings go in tenant_config, not
-- inline in code/other tables.

BEGIN;

-- ============================================================================
-- 1. organizations
-- ============================================================================

CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Fixed UUID for Synergie so tables' organization_id DEFAULT can reference it
-- without a scalar subquery (Postgres doesn't allow those in column DEFAULT).
INSERT INTO organizations (id, slug, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'synergie', 'Synergie Tech Solutions');

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the org list; admins can modify.
CREATE POLICY organizations_read ON organizations FOR SELECT TO authenticated USING (true);
CREATE POLICY organizations_admin_write ON organizations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================================
-- 2. tenant_config
-- ============================================================================

CREATE TABLE tenant_config (
  organization_id                uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  synergie_full_name             text NOT NULL,
  synergie_addresses_block       text NOT NULL,
  default_signer_name            text NOT NULL,
  default_signer_title           text NOT NULL,
  default_signer_email           text NOT NULL,
  initiator_email                text NOT NULL,
  default_cc_emails              text[] NOT NULL DEFAULT '{}',
  default_governing_law          text NOT NULL DEFAULT 'California, USA',
  default_payment_terms          text NOT NULL DEFAULT 'Monthly invoicing, NET 45 payment',
  default_location               text NOT NULL DEFAULT 'Remote, based on USA East Coast timings',
  default_price_cap_hours        int,
  docuseal_contract_template_id  text,   -- filled after template upload
  docuseal_sow_template_id       text,
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenant_config (
  organization_id, synergie_full_name, synergie_addresses_block,
  default_signer_name, default_signer_title, default_signer_email,
  initiator_email, default_cc_emails, default_price_cap_hours
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Synergie Tech Solutions LLC - Br',
  E'11750 Dublin Blvd, Ste 207, Dublin CA 94568 USA\nA1-604, Ajman Free Zone, Ajman, UAE',
  'Danish Banga',
  'General Manager',
  'dbanga@synergietechsolutions.com',
  'contracts@synergietechsolutions.com',
  ARRAY['lpinto@synergietechsolutions.com', 'tjoncic@synergietechsolutions.com'],
  180
);

ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_config_read ON tenant_config FOR SELECT TO authenticated USING (true);
CREATE POLICY tenant_config_admin_write ON tenant_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- 3. counterparties
-- ============================================================================

CREATE TABLE counterparties (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  vendor_short_name      text NOT NULL,        -- "Obrt QAce", "TP Binovate"
  vendor_full_name       text NOT NULL,        -- "T.P. Binovate - Skopje"
  country                text,                 -- country name per Dan clarification 2026-08-31 (US, North Macedonia, etc.)
  address_block          text,                 -- free-form multi-line block
  is_contract_umbrella   boolean NOT NULL DEFAULT false,   -- TEAL-style: 1 contract, N SOWs+resources
  is_payment_umbrella    boolean NOT NULL DEFAULT false,   -- Bimosoft-style: payment routes through them
  default_signer_name    text,
  default_signer_email   text,
  default_signer_title   text,
  notes                  text,
  created_by             uuid REFERENCES profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX counterparties_org_short_name_idx ON counterparties(organization_id, vendor_short_name);

ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY counterparties_contract_admin_all ON counterparties FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- 4. role_descriptions (created before sows because sows FKs to it)
-- ============================================================================

CREATE TABLE role_descriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  title          text NOT NULL,        -- "Senior Software QA Engineering (Manual and Automation)"
  body           text NOT NULL,        -- full body incl. bullet points
  is_active      boolean NOT NULL DEFAULT true,
  superseded_by  uuid REFERENCES role_descriptions(id),
  created_by     uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE role_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_descriptions_read ON role_descriptions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));
CREATE POLICY role_descriptions_write ON role_descriptions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'contract_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'contract_admin'));

-- ============================================================================
-- 5. contracts
-- ============================================================================

CREATE TABLE contracts (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                uuid NOT NULL REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  counterparty_id                uuid NOT NULL REFERENCES counterparties(id) ON DELETE RESTRICT,
  agreement_date                 date NOT NULL,
  effective_date                 date NOT NULL,
  expiration_date                date,          -- default = agreement_date + 1yr per MSA §6.1 (enforced app-side)
  status                         text NOT NULL DEFAULT 'draft',  -- draft|sent|first_viewed|vendor_signed|executed|voided
  docuseal_submission_id         text,
  filled_docx_path               text,          -- Supabase Storage key for the generated DOCX
  signed_pdf_path                text,
  audit_cert_path                text,
  cc_emails                      text[] NOT NULL DEFAULT '{}',
  initiator_profile_id           uuid NOT NULL REFERENCES profiles(id),
  countersigner_profile_id       uuid NOT NULL REFERENCES profiles(id),
  countersigner_name_snapshot    text,
  countersigner_title_snapshot   text,
  vendor_signer_email            text NOT NULL,
  vendor_signer_name_snapshot    text,
  vendor_signer_title_snapshot   text,
  sent_at                        timestamptz,
  first_viewed_at                timestamptz,
  vendor_signed_at               timestamptz,
  countersigned_at               timestamptz,
  executed_at                    timestamptz,
  voided_at                      timestamptz,
  notes                          text,
  created_by                     uuid REFERENCES profiles(id),
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contracts_status_check CHECK (status IN ('draft','sent','first_viewed','vendor_signed','executed','voided'))
);

CREATE INDEX contracts_counterparty_idx ON contracts(counterparty_id, agreement_date DESC);
CREATE INDEX contracts_status_open_idx ON contracts(status) WHERE status NOT IN ('executed', 'voided');

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contracts_contract_admin_all ON contracts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- 6. sows
-- ============================================================================

CREATE TABLE sows (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  contract_id                 uuid NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
  sow_number                  int NOT NULL CHECK (sow_number >= 1),
  is_embedded                 boolean NOT NULL DEFAULT false,          -- true when sow_number = 1 AND signed with contract
  role_description_id         uuid REFERENCES role_descriptions(id),
  role_description_snapshot   text NOT NULL,                            -- always frozen at send time
  resource_profile_id         uuid REFERENCES profiles(id),             -- nullable until create-user runs
  resource_name               text NOT NULL,
  start_date                  date,
  end_date                    date,
  consultants_count           int NOT NULL DEFAULT 1,
  location                    text NOT NULL DEFAULT 'Remote, based on USA East Coast timings',
  price_text                  text NOT NULL,                            -- e.g. "$85/hour"
  price_cap_hours             int,
  payment_terms               text NOT NULL DEFAULT 'Monthly invoicing, NET 45 payment',
  status                      text NOT NULL DEFAULT 'draft',
  docuseal_submission_id      text,
  filled_docx_path            text,
  signed_pdf_path             text,
  audit_cert_path             text,
  sent_at                     timestamptz,
  first_viewed_at             timestamptz,
  vendor_signed_at            timestamptz,
  countersigned_at            timestamptz,
  executed_at                 timestamptz,
  voided_at                   timestamptz,
  created_by                  uuid REFERENCES profiles(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, sow_number),                                    -- composite unique per contract
  CONSTRAINT sows_status_check CHECK (status IN ('draft','sent','first_viewed','vendor_signed','executed','voided'))
);

CREATE INDEX sows_resource_idx ON sows(resource_profile_id, executed_at DESC);

ALTER TABLE sows ENABLE ROW LEVEL SECURITY;

CREATE POLICY sows_contract_admin_all ON sows FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- 7. contract_documents (satellite table for MVP2 use — schema in place now)
-- ============================================================================

CREATE TABLE contract_documents (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  contract_id              uuid REFERENCES contracts(id) ON DELETE SET NULL,
  resource_profile_id      uuid REFERENCES profiles(id),
  doc_type                 text NOT NULL,                       -- "NDA", "IP Assignment", "APFM NDA", ...
  title                    text NOT NULL,
  description              text,
  docuseal_template_id     text NOT NULL,
  docuseal_submission_id   text,
  signer_email             text NOT NULL,
  signer_name_snapshot     text,
  countersigner_profile_id uuid REFERENCES profiles(id),
  countersigner_required   boolean NOT NULL DEFAULT false,
  filled_docx_path         text,
  signed_pdf_path          text,
  audit_cert_path          text,
  status                   text NOT NULL DEFAULT 'draft',
  sent_at                  timestamptz,
  first_viewed_at          timestamptz,
  vendor_signed_at         timestamptz,
  countersigned_at         timestamptz,
  executed_at              timestamptz,
  voided_at                timestamptz,
  created_by               uuid REFERENCES profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_documents_status_check CHECK (status IN ('draft','sent','first_viewed','vendor_signed','executed','voided'))
);

ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_documents_contract_admin_all ON contract_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- 8. docuseal_webhook_events (append-only audit log)
-- ============================================================================

CREATE TABLE docuseal_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  docuseal_event_id   text NOT NULL UNIQUE,     -- for idempotency
  event_type          text NOT NULL,             -- 'submission.completed', 'form.signed', etc.
  submission_id       text NOT NULL,
  parent_kind         text NOT NULL,             -- 'contract' | 'sow' | 'contract_document'
  parent_id           uuid NOT NULL,
  actor_email         text,
  occurred_at         timestamptz NOT NULL,      -- DocuSeal's clock
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,               -- when our handler updated the parent row
  raw_payload         jsonb NOT NULL,
  CONSTRAINT webhook_events_parent_kind_check CHECK (parent_kind IN ('contract', 'sow', 'contract_document'))
);

CREATE INDEX docuseal_events_submission_idx ON docuseal_webhook_events(submission_id, occurred_at);
CREATE INDEX docuseal_events_parent_idx ON docuseal_webhook_events(parent_kind, parent_id, occurred_at);

ALTER TABLE docuseal_webhook_events ENABLE ROW LEVEL SECURITY;

-- Webhook events are written by service_role only (via edge function); readable by admins for forensics.
CREATE POLICY docuseal_events_admin_read ON docuseal_webhook_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'contract_admin')));

-- ============================================================================
-- Existing table modifications
-- ============================================================================

-- Add 'contract_admin' to profiles.role check constraint.
-- Loop-drop ALL existing role-related check constraints (prod had two:
-- 'profiles_role_check' and 'profiles_role_valid' — from separate historical
-- migrations both defining the role enum). Then add a single canonical one.
DO $$
DECLARE
  cn text;
BEGIN
  FOR cn IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%role %'
  LOOP
    EXECUTE format('ALTER TABLE profiles DROP CONSTRAINT %I', cn);
  END LOOP;

  ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('admin', 'accountant', 'manager', 'timesheetuser', 'vendormanager', 'contract_admin'));
END $$;

-- payment_profiles gets counterparty_id for umbrella-payment linkage (Bimosoft-style).
-- Nullable — existing per-user linkage unchanged; new column supports the umbrella case.
ALTER TABLE payment_profiles
  ADD COLUMN counterparty_id uuid REFERENCES counterparties(id) ON DELETE SET NULL;

COMMIT;
