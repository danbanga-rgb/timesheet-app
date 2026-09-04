// Declarative intent schemas. Each intent defines its required_permission
// (checked via has_permission on the caller) and its ordered field list.
//
// LLM-driven flow (2026-09-04 refactor): field specs describe *what* the bot
// needs, NOT *how* to ask for it. The LLM writes all natural-language prompts,
// grouping / phrasing as feels natural given the conversation. Server enforces:
//   - required fields present before confirmation
//   - options-restricted values valid
//   - email / date formats parseable
//   - applies_if gating (e.g. vendor_manager only if role starts with "vendor")
//   - defaults filled at confirmation time
//   - derivations applied in normalizeCaptured (e.g. location_type ← country)

export type InputType = 'text' | 'buttons' | 'buttons+text' | 'date' | 'yes_no';

export interface FieldSpec {
  name: string;
  input_type: InputType;
  options?: string[];                          // static list for buttons
  options_from?: 'projects' | 'vendor_managers'; // dynamic list from DB
  required?: boolean;
  encouraged?: boolean;                        // nice-to-have; LLM can skip if user demurs
  ask_only_if_mentioned?: boolean;             // never asked, only extracted (e.g. invoice_enabled off by default)
  applies_if?: (captured: Record<string, unknown>) => boolean;
  default?: unknown;
  validate?: 'email' | 'date';
  hint?: string;                               // optional context for the LLM (why/when to ask)
}

export interface IntentSpec {
  name: string;
  required_permission: string;
  description: string;
  fields: FieldSpec[];
  extraction_hint: string;  // hint for LLM on what to look for
}

export const INTENTS: IntentSpec[] = [
  {
    name: 'user.set_start_date',
    required_permission: 'user.set_start_date',
    description: 'Set/update the start date of an existing user',
    extraction_hint:
      'The user wants to set or update someone\'s start date. Extract the target person\'s name (or email if given) and the new date.',
    fields: [
      { name: 'target', input_type: 'text', required: true, hint: 'name or email of the existing user' },
      { name: 'start_date', input_type: 'date', required: true, validate: 'date' },
    ],
  },
  {
    name: 'user.set_end_date',
    required_permission: 'user.set_end_date',
    description: 'Set/update the end date of an existing user (offboarding)',
    extraction_hint:
      'The user wants to set or update someone\'s end date, or is offboarding them. Extract the target person\'s name (or email if given) and the new date.',
    fields: [
      { name: 'target', input_type: 'text', required: true, hint: 'name or email of the existing user' },
      { name: 'end_date', input_type: 'date', required: true, validate: 'date' },
    ],
  },
  {
    name: 'user.create',
    required_permission: 'user.create',
    description: 'Create a new user profile (contractor, staff, manager, etc.)',
    extraction_hint:
      'The user wants to create/add/onboard a new person. Extract as many fields as they mention. Do NOT invent values.',
    fields: [
      { name: 'name', input_type: 'text', required: true, hint: 'full name' },
      { name: 'email', input_type: 'text', required: true, validate: 'email' },
      {
        name: 'country',
        input_type: 'buttons+text',
        options: ['US'],
        required: true,
        hint: 'country of residence; US is onshore, anything else is offshore',
      },
      {
        name: 'role',
        input_type: 'buttons',
        options: ['timesheetuser', 'manager', 'accountant', 'vendormanager', 'admin'],
        default: 'timesheetuser',
        ask_only_if_mentioned: true,
        hint: 'defaults to timesheetuser; ask only if user hints at a different role',
      },
      {
        name: 'location_type',
        input_type: 'buttons',
        options: ['onshore', 'offshore'],
        ask_only_if_mentioned: true,
        hint: 'auto-derived from country (US=onshore, else offshore); do not ask separately',
      },
      {
        name: 'project',
        input_type: 'buttons',
        options_from: 'projects',
        encouraged: true,
        hint: 'which project/client they will work on',
      },
      { name: 'start_date', input_type: 'date', encouraged: true, validate: 'date' },
      {
        name: 'vendor_manager',
        input_type: 'buttons',
        options_from: 'vendor_managers',
        applies_if: (c) => typeof c.role === 'string' && c.role.startsWith('vendor'),
        hint: 'only relevant when role is vendormanager or vendor-related',
      },
      {
        name: 'invoice_enabled',
        input_type: 'yes_no',
        default: false,
        ask_only_if_mentioned: true,
        hint: 'off by default; only enable if user says so',
      },
      {
        name: 'send_invite',
        input_type: 'yes_no',
        default: true,
        hint: 'default YES; auto-fires after create unless user opts out',
      },
    ],
  },
];

export function findIntent(name: string): IntentSpec | undefined {
  return INTENTS.find((i) => i.name === name);
}

// Ordered list of intent names for LLM classification prompts.
export function intentCatalog(): Array<{ name: string; description: string }> {
  return INTENTS.map((i) => ({ name: i.name, description: i.description }));
}
