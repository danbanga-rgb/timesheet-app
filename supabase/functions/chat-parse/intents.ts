// Declarative intent schemas. Each intent defines its required_permission
// (checked via has_permission on the caller) and its ordered field list.
//
// Field ordering matters: bot asks fields in listed order, skipping ones
// already captured. `required=true` fields must be present before confirmation.
// `encouraged=true` fields are asked once; user can say "skip" to defer.
// `applies_if` short-circuits (e.g. vendor_manager only if role starts with "vendor").
// `ask_only_if_mentioned`: never ask, only extract if user brings it up
// (used for invoice_enabled — default off unless explicit).
//
// Slice 4 delivers user.create only. Additional intents (set_end_date,
// set_start_date, update_project, update_country_region) land in Slice 6.

export type InputType = 'text' | 'buttons' | 'buttons+text' | 'date' | 'yes_no';

export interface FieldSpec {
  name: string;
  prompt: string;
  input_type: InputType;
  options?: string[];                          // static list for buttons
  options_from?: 'projects' | 'vendor_managers'; // dynamic list from DB
  required?: boolean;
  encouraged?: boolean;                        // ask once, allow skip
  ask_only_if_mentioned?: boolean;             // never ask, only extract
  applies_if?: (captured: Record<string, unknown>) => boolean;
  default?: unknown;
  validate?: 'email' | 'date';
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
    name: 'user.create',
    required_permission: 'user.create',
    description: 'Create a new user profile (contractor, staff, manager, etc.)',
    extraction_hint:
      'The user wants to create/add/onboard a new person. Extract as many fields as they mention. Do NOT invent values.',
    fields: [
      { name: 'name', prompt: "What's the full name?", input_type: 'text', required: true },
      {
        name: 'email',
        prompt: "What's the email address?",
        input_type: 'text',
        required: true,
        validate: 'email',
      },
      {
        name: 'role',
        prompt: 'What role?',
        input_type: 'buttons',
        options: ['timesheetuser', 'manager', 'accountant', 'vendormanager', 'admin'],
        required: true,
      },
      {
        name: 'location_type',
        prompt: 'Onshore or offshore?',
        input_type: 'buttons',
        options: ['onshore', 'offshore'],
        required: true,
      },
      {
        name: 'country',
        prompt: 'Country?',
        input_type: 'buttons+text',
        options: ['US', 'GB', 'HR', 'RS', 'BA', 'MK', 'CA', 'SI'],
        encouraged: true,
      },
      {
        name: 'project',
        prompt: 'Which project?',
        input_type: 'buttons',
        options_from: 'projects',
        encouraged: true,
      },
      {
        name: 'start_date',
        prompt: 'Start date?',
        input_type: 'date',
        encouraged: true,
      },
      {
        name: 'vendor_manager',
        prompt: 'Which vendor manager approves them?',
        input_type: 'buttons',
        options_from: 'vendor_managers',
        applies_if: (c) => typeof c.role === 'string' && c.role.startsWith('vendor'),
      },
      {
        name: 'invoice_enabled',
        prompt: 'Enable invoicing?',
        input_type: 'yes_no',
        default: false,
        ask_only_if_mentioned: true,
      },
      {
        name: 'send_invite',
        prompt: 'Send invite email now?',
        input_type: 'yes_no',
        default: true,
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
