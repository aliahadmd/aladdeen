# Developing Aladdeen

This guide is for people building Aladdeen from source. If you just want to use
the app, see the [README](README.md).

Aladdeen is an Electron app for macOS arm64 (M-series Apple silicon). The main
process owns the file system, the SQLite metadata database, and the search
worker; the sandboxed renderer talks to it through a narrow, validated IPC
bridge. Environment, project-index, and recent-file metadata is stored in
SQLite; document content is never stored there.

## Requirements

Node.js 24+ and pnpm 11.5 (the version pinned in `package.json`; CI installs
with exactly this version, so use it to keep `pnpm-lock.yaml` compatible).

## Run locally

```bash
pnpm install
pnpm dev
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
pnpm check:spreadsheets
pnpm check:presentations
```

`pnpm test:e2e` builds the app and drives it with Playwright, so it needs the
Electron binary that `pnpm install` downloads.

## Packaging

```bash
pnpm dist:mac
```

Aladdeen produces macOS arm64 DMG and ZIP artifacts only. Release packaging is
guarded to native M-series Macs, and builds are ad-hoc signed so the Electron
bundle is internally valid without requiring a paid Apple Developer account.
They are not notarized, so macOS requires the user to approve the first launch
in System Settings → Privacy & Security. The GitHub Actions workflow builds on a
native macOS arm64 runner. Auto-update and publishing are intentionally not
configured.

Each release records the DMG's byte size and SHA-256 in
`aladdeen-web/src/shared/release-manifest.json`; `pnpm check:release` verifies
the versions agree, and `node scripts/check-release-metadata.mjs <dmg>` verifies
a built artifact against the manifest.

## Website

`aladdeen-web/` is the download site: a Cloudflare Worker that serves the
marketing page and streams the DMG from an R2 bucket. See its own `package.json`
for `pnpm check` and `pnpm run deploy`.

## Document editors

### DOCX

DOCX editing uses the Apache-2.0-licensed
[Eigenpal DOCX Editor](https://github.com/eigenpal/docx-editor). Aladdeen pins
the audited `@eigenpal/docx-editor-react@1.9.0` package while Eigenpal completes
its npm namespace transition. See `THIRD_PARTY_NOTICES.md` for attribution.

### XLSX

XLSX editing is fully offline. The renderer lazily loads the Apache-2.0
[Univer](https://github.com/dream-num/univer) spreadsheet engine, while an
isolated worker uses the MIT-licensed
[`@office-kit/xlsx`](https://github.com/office-kit/xlsx) codec to read and write
OOXML locally. Spreadsheet package versions are exact-pinned and release
packaging rejects Univer Pro packages and CDN runtime code. Workbooks containing
features Aladdeen cannot render are protected by compatibility-copy or read-only
handling instead of being silently rewritten.

### PPTX

PPTX editing is fully offline and lazily loads the Apache-2.0
[`pptx-viewer`](https://github.com/ChristopherVR/pptx-viewer) stack. Aladdeen
keeps the viewer behind an internal JSON-safe presentation API, disables its
cloud, collaboration, export, recording, and built-in AI surfaces, and owns all
saving through the existing atomic binary-document path. Exact-pinned release
checks qualify edit/save/reopen behavior and byte-for-byte preservation of
untouched OOXML parts before packaging.
