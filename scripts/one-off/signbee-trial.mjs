#!/usr/bin/env node
// signbee-trial.mjs — send one test signature request via Signbee and print result.
//
// Usage:
//   SIGNBEE_KEY=sb_xxx node scripts/one-off/signbee-trial.mjs [recipient_email]
//
// Default recipient: danbanga@gmail.com

const KEY = process.env.SIGNBEE_KEY;
if (!KEY) {
  console.error('Missing SIGNBEE_KEY env var');
  process.exit(1);
}

const recipient = process.argv[2] || 'danbanga@gmail.com';

const markdown = `# Vendor Consulting Agreement — TRIAL

**This is a Signbee UX evaluation. Do not treat as a real contract.**

---

This Vendor Consulting Agreement ("Agreement") is entered into on September 1, 2026, between:

**Synergie Tech Solutions LLC** ("Company")
**TEST VENDOR** ("Consultant")

## 1. Services

Consultant will provide software engineering services on an as-requested basis.

## 2. Payment

Company will pay Consultant $100 per hour for approved hours, invoiced monthly, NET 45 payment terms.

## 3. Term

This Agreement is effective September 1, 2026 and continues until terminated by either party with 30 days written notice.

## 4. Governing Law

This Agreement is governed by the laws of California, USA.

---

Please sign below to indicate your agreement.`;

const body = {
  markdown,
  sender_name: 'Synergie Contracts Team',
  sender_email: 'contracts@synergietechsolutions.com',
  recipient_name: 'Danish Banga',
  recipient_email: recipient,
};

console.log('POST https://signb.ee/api/v1/send');
console.log('  recipient:', recipient);

const res = await fetch('https://signb.ee/api/v1/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`\nHTTP ${res.status}`);
console.log(text);

if (!res.ok) process.exit(1);

const parsed = JSON.parse(text);
if (parsed.document_id) {
  console.log(`\nCheck email at ${recipient} for signing link.`);
  console.log(`Or fetch details: GET https://signb.ee/api/v1/documents/${parsed.document_id}`);
}
