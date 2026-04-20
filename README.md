# Generic Accessibility QA Project (LinkedIn-Ready)

This project is a reusable automation QA starter to run accessibility checks against LinkedIn (or any web app by changing `BASE_URL`).

## What this includes

- Playwright end-to-end test framework
- Axe-core accessibility engine integration
- Generic smoke tests for key pages
- CI-friendly reporting with Playwright HTML report

## 1) Install

```bash
npm install
npx playwright install
```

## 2) Configure

Copy `.env.example` to `.env` and update values as needed:

```bash
cp .env.example .env
```

Environment variables:

- `BASE_URL` (default: `https://www.linkedin.com`)
- `LINKEDIN_EMAIL` (optional, for authenticated flows)
- `LINKEDIN_PASSWORD` (optional, for authenticated flows)

> Note: The sample suite currently scans public pages. You can add logged-in tests using `tests/helpers/auth.js`.

## 3) Run tests

```bash
npm test
```

Run only accessibility suite:

```bash
npm run test:accessibility
```

Run full accessibility automation pack:

```bash
npm run test:accessibility:full
```

Run quick profile (fast feedback + final PDF):

```bash
npm run test:accessibility:quick
```

Run PR profile (medium sitemap coverage + final PDF):

```bash
npm run test:accessibility:pr
```

Run using sitemap-discovered URLs:

```bash
SITEMAP_URL=https://recordatirarediseases.de/sitemap.xml npm run test:accessibility:sitemap
```

Optional sitemap controls:
- `SITEMAP_MAX_URLS` (default `25`)
- `SITEMAP_TIMEOUT_MS` (default `30000`)
- `SITEMAP_PROFILE` (`quick`=5, `pr`=15, `full`=`SITEMAP_MAX_URLS`)

Accessibility gate controls:
- `ACCESSIBILITY_FAIL_ON_CRITICAL` (`true`/`false`)
- `ACCESSIBILITY_MAX_SERIOUS` (default `0`)
- `ACCESSIBILITY_REPORT_IMPACTS` (default `critical,serious,moderate,minor`)
- `ACCESSIBILITY_READY_SELECTORS` (default `main,header,nav`)
- `ACCESSIBILITY_READY_TIMEOUT_MS` (default `12000`)

Open report:

```bash
npm run report
```

Generate single final report PDF (severity, URL, issue, screenshot, possible fix):

```bash
npm run report:accessibility:developer
```

Accessibility test artifacts are generated under:

`reports/accessibility/`

Final shareable report:
- `reports/accessibility/final-accessibility-report.pdf`
- severity is shown as `High/Medium/Low` (`critical/serious/other`)

Regression history:
- baseline signatures in `reports/accessibility-history/latest-issues.json`

Manual checklist template is available at:

`reports/manual-accessibility-qa-checklist-template.md`

Additional automated suites:
- `tests/keyboard-accessibility.spec.js` for keyboard tab navigation and focus indicator checks
- `tests/low-vision-reflow.spec.js` for narrow viewport reflow checks aligned to zoom/low-vision concerns

Sitemap-generated pages are stored at:

`tests/helpers/pagesToScan.generated.json`

Note: the final report command auto-cleans extra artifacts and keeps one PDF output.

## CI automation

Nightly CI workflow is included at:

`.github/workflows/accessibility-nightly.yml`

It runs the full accessibility pipeline and uploads `final-accessibility-report.pdf` as an artifact.

## How to extend as a Smart QA

1. Add critical user journeys (search jobs, open profile, messaging screens).
2. Add authenticated scans by reusing `loginLinkedIn()`.
3. Add allowlists only when violations are known and accepted.
4. Add CI pipeline step to fail build on `serious` and `critical` violations.
5. Add cross-browser projects after Chromium baseline is stable.

## Suggested test strategy

- **Smoke (PR)**: top pages + one main journey
- **Nightly**: wider page inventory and deeper scans
- **Release Gate**: fail release if new serious/critical violations appear

## Accessibility confidence for weak eyesight and physical disabilities

This suite helps detect common barriers for:
- low vision users (contrast, scalable text issues)
- motor-impaired users (keyboard access and focus issues)
- assistive technology users (semantic/ARIA issues)

Important: automated testing does **not** prove 100% accessibility for all users. Add manual QA for:
- keyboard-only navigation
- screen readers (NVDA, JAWS, VoiceOver)
- browser zoom at 200%
- high-contrast mode

## Ethical and practical note

Always follow the website's terms of use and your company policy. For production monitoring, prefer testing your owned environments and pages where you have permission to automate.
