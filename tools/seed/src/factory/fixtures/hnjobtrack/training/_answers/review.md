**R18. The profile page swallows load errors.**
- `profile/page.tsx:66` logs and renders a half-filled form that then saves over real data (INC-003 shows the damage).

**R19. Accessibility gaps.**
- `JobCard` is a clickable `div`; buttons are hover-only; the drawer has no dialog semantics or focus management; the
  breakdown uses colour only. See ladder M4.

**R20. Tests.**
- Two backend test files, both on the scraper, both with fakes built on assumptions. No API tests, no frontend tests,
  no CI config. **[AI]**

**R21. The auth callback ignores `exchangeCodeForSession` errors (`route.ts:28`).**
- An expired magic link lands on the dashboard logged out, with no message.

