# Contributing

Thanks for helping. This is a small library, so the process is light.

1. Fork and clone, then `npm install` (Node 22 or newer).
2. Create a branch for your change.
3. Add or update tests in `test/`. All HTTP is mocked; never call the live API
   or commit real tokens, phone numbers or app secrets.
4. Run `npm run check` (typecheck, lint, tests, build). It must pass.
5. Update `CHANGELOG.md` under an "Unreleased" heading.
6. Open a pull request describing the change and the Cloud API behaviour it relies on
   (a link to the relevant Meta documentation page helps).

Guidelines: keep zero runtime dependencies, keep types strict, and prefer
small, explicit APIs. Report security issues privately to the maintainer via https://saizul.com.
