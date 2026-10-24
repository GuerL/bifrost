# qvb visual identity — 1.0.0-prototype.2

The portfolio is the foundation source; this release is a Bifrost-only prototype, not a completed cross-product rollout.

Current refinement and screenshot validation: [prototype.2 notes](REFINEMENT.md). The audit below retains the initial implementation record; the refinement notes describe current semantic boundaries.

## Source audit

Retrieved 2026-10-24 from https://qvb.dev/ and its exact linked stylesheet https://qvb.dev/assets/index-C088mbtb.css. The unmodified stylesheet is retained in `source/portfolio.css`; `tokens.json` records its SHA-256. Local corroborating source: `/Users/guerl/Dev/guerl-portfolio/src/styles.css`. No other product repositories were changed.

| Area | Actual portfolio values and selectors |
| --- | --- |
| Font | `:root`: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif. No @font-face or font download in the audited HTML/CSS; rendering depends on installed fonts. |
| Weights | 400 root; 500 diagram/details; 550 buttons, h2, project headings; 600 hero/eyebrow; 750 wordmark; 300 wordmark divider. Browser synthesis/fallback may differ. |
| Type | Body clamp(16px,.25vw + 15px,18px); description clamp(15px,.15vw + 14.5px,16px); navigation/button 14px; label 12px; metadata/caption 13px. H2 clamp(32px,4vw,48px), line-height 1.2, tracking -1.7px. Hero clamp(46px,5.7vw,73px), line-height 1.12, tracking -3.5px; mobile overrides exist in the retained CSS. Paragraph line-height 1.8; descriptions often 1.85. |
| Background/surfaces | Root #0b0d12; project card #11131a; secondary button #14161d, hover #222430; selected filter #20212e; skills #111319. |
| Violet | Accent #9297ff; primary action #a09aff, hover #b5b0ff, ink #151323, border #b1aaff. Focus #aaaaff. These roles are distinct. |
| Text | Root #e9eaf0; secondary #a6acba; subtle #969dae; secondary button #d1d4df. |
| Borders/radii | Divider #252833; cards #292c37 / hover #55546e; secondary button #31343f. Button 6px, card 10px, skills/sidebar 8px, tags 4px, filters 5px. |
| Spacing | Observed 4, 8, 12, 16, 20, 24, 32, 40px, plus many contextual values (7, 9, 10, 15, 18, 22, 26, 30px etc.). No original uniform spacing scale. Section padding 82px 40px, mobile 56px 22px. |
| Buttons | Inline flex, 15px gap, 13px 20px padding, min-height 45px, 14px/550, radius 6px. Hover translates -2px; 200ms background/transform. Mobile 12px 15px. |
| Inputs | No portfolio text-input component or input focus specification. Bifrost keeps its existing density and input behavior. |
| Focus | Links/buttons: 2px solid #aaaaff outline with 6px offset. Prototype uses 2px offset in dense desktop controls to avoid clipping. |
| Shadows/motion | Primary 0 4px 25px #7872e018; floating tags 0 8px 24px #0004. Cards transition 250ms and lift -3px; tag float 7s ease-in-out, midpoint -7px. Reduced-motion removes motion. |
| Modes | Dark only. No portfolio light palette exists. |

## Token contract

`tokens.json` is framework independent; `src/design/qvb-tokens.css` is its CSS projection (`--qvb-*`). Foundation values are extracted, not new palette choices. Tokens intentionally cover reusable roles rather than every illustration color. Names for the observed spacing values are new normalization. Do not change foundation values to accommodate one product: adapt semantic roles instead.

Version with SemVer: breaking names/types/removal => major; additive roles => minor; corrections => patch. Prerelease remains until visual review. Ship JSON, CSS and changelog together; regenerate CSS from the JSON `tokens` map as `--qvb-{key}: {value}`. Every intentional product deviation belongs in its adapter and review notes.

React imports foundation CSS and a product adapter, with no Tailwind or shared component package. Tauri uses this same React CSS in its webview; native chrome, window sizing, drag regions and Monaco themes remain platform concerns. Flutter should generate an immutable QvbTokens class/ThemeExtension: hex alpha -> Color ARGB, px -> logical pixels, font roles -> TextTheme, colors -> semantic ColorScheme, radii -> BorderRadius, durations -> Duration. Resolve clamp typography at explicit responsive breakpoints; preserve product text scaling and bundle a licensed font only in a separate deliberate change. Do not map success/error to primary.

## Bifrost prototype and comparison

`src/design/bifrost-qvb.css` maps existing `--pg-*` UI roles. It keeps 30px desktop controls, layout, HTTP method tones, error/success/warning roles, JSON colors, editor backgrounds, Monaco syntax and native behavior. Dense controls use the stronger existing portfolio subtle-text color (#969dae), rather than treating decorative #252833 dividers as sufficient input boundaries. Dark overlay opacity is a documented product adaptation. Existing component-specific radii remain for incremental adoption.

Light mode keeps Bifrost surfaces and text. Its accent is the portfolio's #6664b8 selection violet, with white action text; this is a product mapping, not a claimed portfolio light theme. Focus covers inputs and Radix options, with reduced motion for adapted controls. Inter falls back to system fonts as on the portfolio. The root application previously forced system-ui; it now inherits the family.

Run `npm run dev`, open `/design-review/` for a self-contained side-by-side specimen with light/dark switch and focusable controls. It includes real CSS snapshots, not claimed screenshots. Open `/?identity=legacy` or `/?identity=qvb` for the actual app; reload with the same stored theme/data for comparison. Native-backed operations require Tauri. Default is qvb; the legacy query bypasses the adapter without changing saved data. Remove the adapter imports and dataset assignment to roll back. The standalone specimen is a review snapshot; regenerate it when adapter values change.

## Migration sequence

1. Review Bifrost in its native webview with real collections, dialogs and long names. Approve token prerelease before stabilization. Keep code editors independently themed. Audit remaining inline styles component by component rather than replacing CSS globally.
2. Scopa: inspect its actual theme first. Adopt typography, lobby controls, modals and score-panel surfaces; keep the Italian deck artwork, suits, contrast, hit areas and a distinctive green table. Test lobby, deal, selection, capture, score and reconnect states across mobile/desktop. No implementation in this phase.
3. WhateverPeaks: inspect its actual theme. Adopt lobby/results/actions, score typography and neutral panel boundaries; preserve gameplay geometry, card faces and a subtle product-specific background. Timer urgency remains warning/error with text cues. Test countdown, selected/disabled cards and results at mobile widths. No implementation in this phase.
4. FamilyList: later map React and Flutter semantics together; retain shopping completion, category colors and mobile touch targets. Preserve existing theme support and offline/sync/error cues. Do not impose dense Bifrost sizing.
5. GRYD: future Flutter ThemeExtension using the same versioned foundation. Canvas, measurements, selection handles, layers and precision tools need dedicated contrast/readability validation independently of violet chrome.

## Validation record and release gate

Production TypeScript/Vite build passed. All 24 existing test files / 199 tests passed. Vite reports an existing-sized large JS bundle warning; no dependency added. Static review confirms no changes to request execution, editor themes, semantic status colors, layout geometry or game repositories. These checks do not establish native runtime or visual accessibility compliance.

Pending hands-on validation: Tauri macOS/Windows/Linux at 100% and 200% scale; dark/light/system theme switches; complete keyboard traversal and visible focus, Radix menus and modal focus return/Escape; input boundaries and disabled states; request send/cancel, import/export, tabs, resizing, scripts and runner; long URLs/names; JSON and Monaco syntax/search/selection readability. Confirm actual computed font and clipping. Bifrost remains a desktop client; 390px specimen stacking is a review-page behavior, not new mobile support. Game card visibility and mobile gameplay are deferred until those repositories are audited and explicitly authorized for migration. No screenshots or native runtime tests were performed in this environment.

Measured WCAG relative-luminance contrast for representative opaque token pairs (not a full rendered UI audit):

| Pair | Ratio |
| --- | --- |
| Dark text (#e9eaf0 / #11131a) | 15.45:1 |
| Dark muted (#a6acba / #11131a) | 8.16:1 |
| Dark action (#151323 / #a09aff) | 7.45:1 |
| Light action (#ffffff / #6664b8) | 5.15:1 |
| Light accent (#6664b8 / #ffffff) | 5.15:1 |
| Dark focus (#aaaaff / #14161d) | 8.52:1 |
| Dark control boundary (#969dae / #14161d) | 6.66:1 |
