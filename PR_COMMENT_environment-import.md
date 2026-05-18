# PR: Environment Import/Export (Selective Variables + Safe UX)

## Summary
This PR adds full environment import/export support with a safety-first UX for sharing environments.

The implementation focuses on:
- **Selective variable export** (user chooses exactly what to export)
- **Sensitive variable detection** (unchecked by default on export)
- **Import preview before apply**
- **Conflict handling** for both environment names and variable keys
- **Cleaner Environments modal header actions** for better desktop UX scalability

---

## Why
Environment sharing is common, but users need explicit control to avoid leaking secrets (tokens, passwords, API keys) or temporary runtime values.

This PR introduces an explicit and modern flow where users can review, select, and control what gets exported/imported.

---

## What changed

### 1) New environment import/export feature module
Created a dedicated feature folder to keep business logic separate from UI:

- `src/features/environment-import-export/environmentImportExportTypes.ts`
- `src/features/environment-import-export/sensitiveVariableDetection.ts`
- `src/features/environment-import-export/environmentExport.ts`
- `src/features/environment-import-export/environmentImport.ts`
- `src/features/environment-import-export/EnvironmentExportDialog.tsx`
- `src/features/environment-import-export/EnvironmentImportDialog.tsx`
- `src/features/environment-import-export/environmentImportExport.test.ts`

### 2) Export flow (selective + safe)
- Added **Export Environment** flow from Environments management.
- User can:
  - choose environment
  - select/deselect variables
  - select all / deselect all
  - preview the final JSON payload before export
- Sensitive variables are auto-detected and **unchecked by default**.
- Users still have final control and can include sensitive variables manually.
- Export format is versioned and written as JSON (`.bifrost-env.json` suggested).

### 3) Import flow (preview + control)
- Added **Import Environment** flow with file picker + parse/validation.
- Import always goes through a **preview dialog before applying**.
- User can:
  - deselect variables before import
  - choose variable conflict strategy:
    - overwrite existing
    - skip existing
    - rename duplicates
  - choose environment name conflict strategy:
    - merge into existing
    - create duplicate environment
    - rename imported environment
- Robust invalid file handling with clean failure messaging.

### 4) Sensitive variable detection helper
Implemented `isSensitiveVariable(name: string): boolean` (case-insensitive / normalized matching), including:
- token
- accessToken
- refreshToken
- password
- secret
- apiKey
- bearer
- jwt
- authorization
- auth

### 5) Environments modal UX cleanup
Refactored action placement in `EnvironmentsModal` to reduce sidebar clutter:
- Sidebar now focuses on environment navigation/list
- Header actions are now inline in one row:
  - `New`, `Duplicate`, `Import`, `Export`, `[X Close]`
- Close button uses an SVG cross icon instead of text for cleaner desktop presentation.
- `Duplicate` and `Export` are disabled when no environment is selected.

### 6) App integration
Integrated feature flows into app state and command usage in:
- `src/App.tsx`

This includes:
- open/save dialog wiring
- read/write file commands
- preview modal state
- plan-based import apply logic
- environment reload after import/export operations

---

## Export file format
```json
{
  "type": "bifrost-environment",
  "version": 1,
  "environment": {
    "name": "Bruno import",
    "variables": {
      "apiUrl": "...",
      "newCreatedFamily": "7"
    }
  }
}
```

---

## Files changed in this branch
- `src/App.tsx`
- `src/components/EnvironmentsModal.tsx`
- `src/features/environment-import-export/EnvironmentExportDialog.tsx`
- `src/features/environment-import-export/EnvironmentImportDialog.tsx`
- `src/features/environment-import-export/environmentExport.ts`
- `src/features/environment-import-export/environmentImport.ts`
- `src/features/environment-import-export/environmentImportExport.test.ts`
- `src/features/environment-import-export/environmentImportExportTypes.ts`
- `src/features/environment-import-export/sensitiveVariableDetection.ts`

---

## Validation
Executed locally:
- `npm run test`
- `npm run build`

Result:
- ✅ Tests pass
- ✅ Build passes
- ✅ No regression observed in environment create/duplicate/import/export flows

---

## Notes
- No backend schema migration required.
- No breaking API changes introduced.
- Feature is structured to allow future additions (search/filter, icons, shortcut hints, richer masking policies) without bloating `App.tsx`.
