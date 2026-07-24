<p align="center">
  <img src="build/icon.svg" width="88" height="88" alt="Aladdeen genie lamp logo">
</p>

# Aladdeen

Aladdeen is a responsive, offline-first Markdown viewer and editor made only for macOS arm64 on M-series Apple silicon (M1 or newer). It keeps ordinary `.md` files on disk, gives them a clean live preview, and exports finished documents to PDF or DOCX without a network connection.

## Features

- Preview-first reading with adaptive split editing
- Named environments containing multiple folder projects and standalone files
- Bulk-linked project folders with all-files or selective indexing, exclusions, groups, favorites, and archive/pause controls
- Lazy searchable project trees, persistent recent files, cross-project Quick Open, and mixed-project draggable tabs
- Cancellable environment-wide Markdown source search with exact editor reveal
- Debounced atomic autosave with external-change conflict recovery
- GFM tables, task lists, fenced code highlighting, and local images
- Light, dark, system, and accent themes
- Native create/add, rename, reveal, Trash, missing-file relink, open-file association, and per-environment session restore
- Clean offline PDF and DOCX exports
- Sandboxed renderer with a narrow, validated IPC bridge

## Development

Requirements: Node.js 24+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Packaging

```bash
pnpm dist:mac
```

Aladdeen produces macOS arm64 DMG and ZIP artifacts only. Release packaging is guarded to native M-series Macs, and builds are ad-hoc signed so the Electron bundle is internally valid without
requiring a paid Apple Developer account. They are not notarized, so macOS requires
the user to approve the first launch in System Settings → Privacy & Security. The
GitHub Actions workflow builds on a native macOS arm64 runner. Auto-update and
publishing are intentionally not configured.

## Keyboard shortcuts

- `Cmd+O`: open a Markdown file
- `Cmd+Shift+O`: add an existing folder project
- `Cmd+P`: search every indexed project file
- `Cmd+Shift+F`: search Markdown contents in the active environment
- `Cmd+S`: flush autosave now
- `Cmd+E`: toggle editing

Environment, project-index, and recent-file metadata is stored in SQLite; Markdown content is never imported into the database. Aladdeen does not provide cloud sync, remote image fetching, plugins, or WYSIWYG editing. Your Markdown remains portable and under your control.
