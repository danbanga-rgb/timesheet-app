// Global Vitest setup for jsdom-environment tests.
//
// Registers `@testing-library/jest-dom` matchers (toBeInTheDocument,
// toHaveTextContent, etc.) with Vitest's `expect`. Only files that opt into
// jsdom via `// @vitest-environment jsdom` header hit this setup meaningfully;
// node-env tests import it too but the matchers register into the same
// `expect` and cost nothing when unused.
//
// Added as Slice X1 of the accountant modularization arc (2026-09-16).

import '@testing-library/jest-dom/vitest';
