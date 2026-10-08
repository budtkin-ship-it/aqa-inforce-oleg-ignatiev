# QA Automation Test Assignment

UI and API tests using Playwright + TypeScript.

Requirements: Node.js.

## Setup

```sh
npm install
npx playwright install
```

## Run

```sh
npm test
npm run test:ui
npm run test:api
npm run typecheck
```

Manual test cases are in `test-cases.txt`.

UI-003 currently fails because booked dates are not shown as unavailable in the calendar, although the API returns them as unavailable.

