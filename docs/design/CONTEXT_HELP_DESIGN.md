# Context help and page descriptions

Implemented November 4, 2026 for Jacob's request for a small circled information icon on every page, additional explanations where useful, and clearer short descriptions. This is a UI/content change, with no schema change, provider call or new financial feature.

## What users see

Every one of the 14 primary pages has a short action-oriented description and a circled information button next to its title. Additional buttons explain budget room, household balances, bill payments/invoices, savings-goal funding, balance checkpoints, category defaults, planned cash, card cycles/payment allocation, import sources/coverage/processing, optional AI, month close/rollover, themes, local recovery, encrypted handoff, charge lines and spending trends.

Help focuses on purpose, when to use the feature and distinctions that affect interpretation. Budget allowance is different from checking cash; expected movements are different from actual transactions; a bill or statement is not an additional expense; repayment is not income. Text describes implemented capabilities. Payroll and automatic OneDrive backups remain proposed. Existing warnings, confirmation requirements and essential form instructions remain visible outside tooltips.

## Interaction and accessibility

- Hover or keyboard-focus the 28px button to open a compact explanation. The icon itself is 16px. Click/Enter/Space can keep it open; activating again dismisses it. Moving the keyboard focus away ends that focus interaction.
- The pointer can move into the explanation and read it without a timed dismissal. A 140ms crossing allowance bridges the small icon-to-popup gap; it is not a reading time limit.
- Escape dismisses help first, without submitting or closing an underlying edit dialog. Clicking outside dismisses it. Opening another help item closes the previous one. Navigation unmounts obsolete page help.
- Each trigger has an explicit `Help: …` accessible name, a visible focus ring and a description relationship to its open `role="tooltip"` content. Help is plain text, not a mini form or nested set of links. Real headings remain separate, retaining their accessible names and levels.
- Native manual popovers put explanations above clipped cards and dialogs. On an engine without that API, a fixed-position portal attaches to the active dialog or document body. Position is clamped to the viewport and recalculated on scroll/resize. This fallback has an automated test.
- Shared theme tokens control colors, borders and shadows; terminal/pastel corner treatments are retained. The popup body uses normal text contrast. No external assets or help service are used.

The hover/focus behavior follows the dismissible, hoverable and persistent goals described by [W3C's guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html). Native layering uses the [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API). Passing browser interaction/contrast checks does not constitute a full screen-reader or native WebView accessibility audit.

## Code ownership and future additions

- [helpContent.ts](../../src/helpContent.ts) is the typed catalog of page titles/descriptions and contextual explanations. Amend it when behavior changes. Avoid putting tax promises, unsupported features or implementation jargon in help.
- [HelpTip.tsx](../../src/HelpTip.tsx) owns interaction, one-at-a-time behavior, cleanup, position and overlay placement. It invokes no financial commands.
- [help.css](../../src/help.css) owns shared appearance. Keep explanations concise and use layout gaps rather than placing help buttons inside labels, other buttons or headings.
- `HelpHeading` places a real heading next to a help button. `HelpTip` can be used alone beside a relevant section or action. Prefer one explanation per concept over an icon on every field. Do not make critical guidance available only on hover.
- [App.tsx](../../src/App.tsx) consumes the page catalog for the 14 primary destinations; feature components add contextual topics where needed. Future Pay & hours screens should adopt the same pattern when built.

Tests live in [app.spec.ts](../../tests/ui/app.spec.ts): reading across the hover gap, keyboard/click dismissal, one explanation at a time, all-page navigation, no financial writes, viewport bounds/top-layer hit testing, native/fallback dialog behavior and preserved drafts. Existing theme cases now check tooltip contrast and visibility. See [checkpoint QA](../qa/QA_2026-11-04_context_help.md) for actual results and delivered hashes.
