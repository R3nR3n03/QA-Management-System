/**
 * Loaded before every spec. Custom commands only — no global `beforeEach` that reseeds, because
 * the specs disagree about when they want fresh data and a hidden one would reseed under a spec
 * that had just arranged its own state.
 */

import "./commands";

/**
 * Next's client router logs a benign hydration-timing error in some navigations, and Cypress
 * fails a test on any uncaught exception by default. Narrowed to that one message rather than
 * blanket-disabled: a real application error must still fail the spec that provoked it.
 */
Cypress.on("uncaught:exception", (error) => {
  if (/NEXT_REDIRECT|Hydration failed|Minified React error #418|#423/.test(error.message)) {
    return false;
  }
  return true;
});
