# qvb prototype.2 — quieter Bifrost hierarchy

The foundation palette and typography are unchanged. The initial adapter incorrectly promoted subtle text to the generic border role, so nested structural containers looked like fields. The refinement separates their semantics instead of masking individual screens with CSS overrides.

| Level | Shared role | Treatment |
| --- | --- | --- |
| Application | `--pg-bg-main` | Portfolio canvas |
| Surface | `--pg-surface-0` | Content panels |
| Elevated | `--pg-elevated-surface` | Runner/settings dialog shells; dark selected-surface neutral, existing light surface |
| Hover | `--pg-control-bg-hover` | Existing neutral hover, with no added button shadow |
| Selected/focused | `--pg-tab-active-bg`, focus outline | Restrained violet fill; 2px keyboard outline retained |

`--pg-border` is structural again; `--pg-border-soft` is a divider. `--pg-section-border` is transparent for nested sections while retaining their original box geometry. `--pg-control-border` is intentionally stronger for inputs and select triggers. Secondary actions use `--pg-button-bg` and transparent `--pg-button-border`; shared `buttonStyle` and `tabStyle` apply the treatment at the source. No global `!important` overrides were added.

The Runner uses open sections, group dividers and neutral execution rows. Status and HTTP badges retain distinct colors and explicit labels, including skipped and cancelled. Running uses informational blue rather than another violet outline. Status foreground roles have separate dark/light values; the pale fixed badge colors previously failed on light surfaces. Primary actions, destructive controls, keyboard focus and input boundaries retain their stronger treatment.

The same shared boundary/button roles affect modals, sidebar controls, settings and import/export dialogs. Settings uses the shared tab treatment and unoutlined section cards. Request tabs lose the extra selection shadow/outline. Response JSON panels keep neutral boundaries rather than a permanent violet ring. Layout sizing, handlers, filters, grouping, execution state transitions, method tones and syntax colors were not changed.

## Validation

[Open screenshot comparison](screenshots/index.html). Dark/light before-and-after captures use the actual Runner component in an isolated React fixture with fixed synthetic data, 1440×1100 viewport. The before fixture uses the pre-refinement Runner, shared button helper and CSS. Screenshots were visually inspected; full state captures include running and queued rows below the scroll fold.

Browser checks in both themes traversed all 21 enabled Runner buttons with Tab: every stop reported `:focus-visible` with a 2px outline. Enter activation exercised Failed (2 visible rows, including cancelled according to the existing filter), Success (1), All (6), Averages (no execution rows) and back to Executions (6). No runtime exceptions were reported. Raw evidence: `screenshots/browser-check.json`. Fixture actions never execute HTTP requests or cancel real runs.

Production TypeScript/Vite build passed; 24 test files / 199 tests passed. `git diff --check` passed. Existing large bundle warning remains. Native Tauri, OS-specific rendering, complete modal focus trapping/return, and live HTTP execution were not tested. The captured Runner has unchanged scrolling geometry; lower rows are intentionally shown in separate screenshots.

The initial audit README records the first prototype's review limitations and contrast samples; this file supersedes its statements about the current adapter's bright structural border and lack of screenshots. Foundation tokens remain extracted from the portfolio; semantic status and hierarchy roles belong to Bifrost.
