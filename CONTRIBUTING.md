# Contributing to Signora PDF

Thanks for your interest! This project values small, well-tested changes and clean boundaries.

## Setup

```bash
git clone https://github.com/oscarandrespabonestrella/signora-pdf.git
cd signora-pdf
npm install
npm start      # playground on http://localhost:4200
```

Requires Node 22 or 24 and npm 10+.

## Repository layout

- `projects/signora-pdf/` — the publishable library (`signora-pdf`) and its secondary entry points
  (`pdfjs`, `pdf-lib`, `ui`).
- `projects/playground/` — demo app. It must only use the library's **public API**.
- `docs/` — architecture, coordinates, theming, roadmap.

## Architecture rules

1. The core entry point (`signora-pdf`) and `ui` must not import `pdfjs-dist` or `pdf-lib`.
   ESLint enforces this. Engines live behind ports, in their own entry points.
2. Cryptographic signing stays separate from visual signing, and no cryptography is implemented
   in this repository: integrate existing services behind the provider interfaces.
3. Placements are stored in normalized page coordinates. Use the functions in
   `src/lib/coordinates`; do not do ad-hoc pixel math in components.
4. Styling goes through `--signora-*` CSS variables with a fallback. Do not hard-code values that
   a consumer might want to change.
5. Components are standalone, `OnPush`, signal-based and accessible (labels, focus, keyboard).

## Workflow

1. Open an issue first for anything bigger than a small fix.
2. Create a branch, make focused commits ([Conventional Commits](https://www.conventionalcommits.org/)
   are appreciated: `feat:`, `fix:`, `docs:`...).
3. Before opening a PR run:
   ```bash
   npm run lint
   npm test
   npm run build
   ```
4. Add or update tests and docs. Add an entry under **Unreleased** in `CHANGELOG.md` for
   user-visible changes.
5. Fill in the pull request template.

## Documentation and screenshots

- Public symbols need a doc comment: the API reference is generated from them (`npm run docs:api`).
- If you change the look of the UI, refresh the README images with `npm run screenshots` (the
  playground must be running). The script drives the real playground, so it doubles as a smoke test.

## Accessibility

UI changes must keep the default UI usable with a keyboard and a screen reader: one focus stop per
control, visible focus, accessible names, no fixed heading levels inside components, text contrast
of at least 4.5:1 in every theme preset. Automated checks (for example axe-core) find only part of the
problems, so please also tab through your change.

## Tests

Unit tests use Vitest through the Angular CLI (`ng test <project> --watch=false`). Pure logic
(coordinates, session) should have thorough tests; changes to coordinate math need round-trip
tests over all four rotations.

## Releases

Maintainers release from `main`: update the version in `projects/signora-pdf/package.json`,
move the changelog entries under the new version, tag `vX.Y.Z` and run the **Release**
workflow. Versions follow [SemVer](https://semver.org/); pre-1.0 minor versions may contain
breaking changes.

## Code of conduct

By participating you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
