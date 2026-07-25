# AgentRiskLayer 4.2 Accessibility Review

This release includes an internal accessibility review. It is not a third-party WCAG certification.

## Implemented

- Semantic headings, forms, labels and buttons across core flows.
- Visible keyboard focus using `:focus-visible`.
- No essential information communicated only by colour.
- Error and status content rendered as text.
- Responsive layouts for mobile and desktop.
- Strict CSP-compatible presentation without inline styles.
- Report metrics include textual values alongside visual bars.

## Automated/static checks

- Every form control in the authentication, assessment and security-settings flows has an accessible label or associated text.
- Internal navigation targets exist.
- No duplicate HTML IDs were found in public pages.
- No inline style attributes are present.

## Known limitations

- The generated PDF is visually validated, contains 13 section bookmarks and metadata, but is not yet a fully tagged PDF/UA document.
- A professional screen-reader audit on NVDA, VoiceOver and TalkBack remains required.
- Colour-contrast and zoom/reflow should be independently verified against WCAG 2.2 AA on the deployed site.
- Complex data tables and charts should receive user testing with assistive technology.
