// Global Vitest setup for jsdom-environment tests.
//
// Registers `@testing-library/jest-dom` matchers (toBeInTheDocument,
// toHaveTextContent, etc.) with Vitest's `expect`. Only files that opt into
// jsdom via `// @vitest-environment jsdom` header hit this setup meaningfully;
// node-env tests import it too but the matchers register into the same
// `expect` and cost nothing when unused.
//
// Also registers per-test cleanup so component tests get a fresh DOM
// between cases (added in T1 after multiple-element matches surfaced).
//
// Added as Slice X1 of the accountant modularization arc (2026-09-16).
// Cleanup hook added in Slice T1.

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
