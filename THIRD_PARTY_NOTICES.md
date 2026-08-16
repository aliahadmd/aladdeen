# Third-party notices

Aladdeen is proprietary software and includes third-party components under
their own licenses.

## Eigenpal DOCX Editor

- Package: `@eigenpal/docx-editor-react`
- Version: `1.9.0`
- Project: https://github.com/eigenpal/docx-editor
- Copyright: Eigenpal DOCX Editor contributors
- License: Apache License 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

Eigenpal DOCX Editor is used for local DOCX parsing, rendering, editing, and
serialization. Its inclusion does not change Aladdeen's proprietary license.

## Univer spreadsheet engine

- Packages: `@univerjs/core`, `@univerjs/preset-sheets-core`,
  `@univerjs/preset-sheets-filter`, `@univerjs/preset-sheets-sort`,
  `@univerjs/preset-sheets-find-replace`,
  `@univerjs/preset-sheets-data-validation`,
  `@univerjs/preset-sheets-conditional-formatting`, and
  `@univerjs/preset-sheets-hyper-link`
- Version: `0.25.1` (all packages)
- Project: https://github.com/dream-num/univer
- Copyright: DreamNum Co., Ltd. and Univer contributors
- License: Apache License 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

Only the open-source local spreadsheet packages are included. Univer Pro,
collaboration, server exchange, telemetry transport, and CDN loading are not
used.

## Office Kit XLSX codec

- Package: `@office-kit/xlsx`
- Version: `0.9.0`
- Project: https://github.com/office-kit/xlsx
- Copyright: Office Kit XLSX contributors
- License: MIT License
- License text: https://github.com/office-kit/xlsx/blob/main/LICENSE

Office Kit provides local XLSX OOXML reading, writing, and preservation of
unsupported workbook parts behind Aladdeen's internal codec worker.

## RxJS

- Package: `rxjs`
- Version: `7.8.2`
- Project: https://github.com/ReactiveX/rxjs
- Copyright: Google, Inc. and RxJS contributors
- License: Apache License 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

RxJS is the exact-pinned peer runtime used by Univer.

## PPTX Viewer

- Packages: `pptx-vanilla-viewer`, `pptx-viewer-core`, `pptx-viewer-mcp`
- Versions: `1.7.0`, `2.0.7`, `2.0.2`
- Project: https://github.com/ChristopherVR/pptx-viewer
- Copyright: ChristopherVR and pptx-viewer contributors
- License: Apache License 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

The viewer stack is used locally for PPTX parsing, rendering, editing,
presentation mode, serialization, and typed agent-oriented schemas. Aladdeen
does not expose its MCP server or enable its collaboration, cloud, recording,
download, or built-in AI facilities.

## Three.js

- Package: `three`
- Version: `0.185.1`
- Project: https://github.com/mrdoob/three.js
- Copyright: Three.js authors
- License: MIT License
- License text: https://github.com/mrdoob/three.js/blob/dev/LICENSE

Three.js is included to satisfy the PPTX viewer's locally bundled optional
SmartArt renderer import. Aladdeen keeps 3D SmartArt disabled in v1.

## PPTX viewer font and metafile helpers

- Packages: `emf-converter`, `mtx-decompressor`
- Versions: `2.0.2`, `1.6.0`
- Project: https://github.com/ChristopherVR/pptx-viewer
- Licenses: Apache License 2.0 (`emf-converter`), Mozilla Public License 2.0 (`mtx-decompressor`)
- MPL text: https://www.mozilla.org/MPL/2.0/

These unmodified dependencies support local EMF conversion and embedded-font
decompression. MPL-2.0 obligations remain limited to the unmodified
`mtx-decompressor` component and do not change Aladdeen's proprietary license.
