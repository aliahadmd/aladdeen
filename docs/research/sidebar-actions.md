# Compact sidebar actions

Implemented 2026-11-13.

The sidebar reserves its vertical space for projects and documents. A single
43-pixel action row contains two labeled menu buttons: **Open** and **New**.

| Before | After | Why |
| --- | --- | --- |
| Four stacked actions and a divider | One row with Open and New | Frees vertical space while retaining visible, descriptive labels. |
| Existing and new items mixed together | Open contains Add folder and Open file; New contains document formats and folder creation | Groups actions by intent and distinguishes existing sources from new content. |
| Multiple folder menus with different wording | Projects “+” directly opens the same Add folder workflow | Keeps a fast contextual shortcut and one import flow. |
| Folder creation destination is implicit | New shows the selected project/subfolder and distinguishes New subfolder from New project folder | Makes the destination clear before the action is chosen. |
| Scroll area's intrinsic table width can exceed the sidebar | Constrained vertical library layout | Prevents focus from scrolling project labels horizontally out of view. |

The two menus use the existing Radix Dropdown Menu primitive for keyboard
navigation, Escape, and focus return. The implementation retains the existing
open/import shortcuts and uses shared document-format menu items in the sidebar
and project context menus. Menus add a selection step; shortcuts and the project
“+” preserve direct access for common operations.

This design applies the [WAI menu-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
and [Radix's accessible menu behavior](https://www.radix-ui.com/primitives/docs/components/dropdown-menu).
It also follows [Apple's sidebar guidance](https://developer.apple.com/design/human-interface-guidelines/sidebars)
on succinct labels and managing limited sidebar space. The exact grouping and
43-pixel row are product choices, not requirements of those sources.

Validation: production build/typechecking, ESLint, 212 unit tests, and 20 Electron
end-to-end tests passed. Coverage exercises real folder imports, original-file
opening, document and subfolder creation in the selected directory, independent
project-folder creation, keyboard focus return, a 248-pixel sidebar, and compact
900/640-pixel windows. Horizontal library overflow is checked after focus returns
from the project “+” workflow. The settings screenshot test now selects themes through the actual
settings controls, with reviewed dark-mode baselines; the full suite runs without
exclusions.
