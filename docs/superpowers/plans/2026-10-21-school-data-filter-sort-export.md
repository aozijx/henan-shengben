# School Data Filter-Sort-Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a metadata-driven school-data pipeline whose filtered and sorted preview is the single source for paginated display and CSV export.

**Architecture:** Load and validate one metadata document before loading its declared data sources. Keep filtering, aggregation, sorting, pagination and CSV serialization as DOM-free pure modules; the UI owns one state object and renders controls, columns and export fields from metadata.

**Tech Stack:** Native ES modules, HTML/CSS, browser Fetch/Web Storage/Blob APIs, Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-10-21-school-data-filter-sort-export-design.md`

## Global Constraints

- The pipeline order is raw data → filters → aggregation → sort → preview → export.
- Preview rows and exported rows must be the same complete result array; pagination affects rendering only.
- Raw data, indexes, search results, filtered data and preview data must never be written to `localStorage`.
- Adding 2027 changes only data files and metadata, never production business-logic JavaScript.
- Controls, sortable fields, preview columns and export headers come from metadata.
- Build from commit `6cb3f19`; preserve its three-year plan data and year-group/table behavior while migrating the separate summary table into the new preview flow.

## Review Focus

- A lower score greater than the upper score shows validation feedback and leaves the last valid result intact (Task 3 test).
- Duplicate ordinary/special-plan rows for one school count as one effective school while plan totals still include both rows (Task 3 test).
- CSV values containing commas, quotes or newlines round-trip correctly and open as UTF-8 Chinese text (Task 6 test).
- Corrupt column-width storage falls back to metadata widths without blocking initialization (Task 7 test).
- A required 2027 source failing to load reports its configured file path and never enables export (Task 8 test).

---

### Task 1: Add a zero-dependency test harness and metadata contract

**Files:**
- Create: `package.json`
- Create: `metadata/school-data.json`
- Create: `js/metadata.js`
- Create: `tests/metadata.test.js`

**Interfaces:**
- Produces: `loadMetadata(url, fetchImpl) -> Promise<Metadata>` and `validateMetadata(value) -> { valid: boolean, errors: string[] }`.
- `Metadata.fields` exposes `key`, `label`, `exportLabel`, `type`, `enumValues`, `min`, `max`, `filterEnable`, `sortEnable`, `tableShow`, and `exportEnable`.

- [ ] **Step 1: Add failing metadata validation tests** for a valid document, duplicate field keys, unknown default sort keys, missing source paths, invalid default year, invalid numeric bounds and an empty export-column set.
- [ ] **Step 2: Run `npm test -- tests/metadata.test.js`** and verify failure because `js/metadata.js` does not exist.
- [ ] **Step 3: Implement `validateMetadata` and `loadMetadata`**, and encode 2024–2026 sources, score presets, default sort, page size and field switches in `metadata/school-data.json`.
- [ ] **Step 4: Run `npm test -- tests/metadata.test.js`** and verify all metadata tests pass.
- [ ] **Step 5: Commit** with `git add package.json metadata/school-data.json js/metadata.js tests/metadata.test.js` and message `feat: add school data metadata contract`.

### Task 2: Make source loading and indexes metadata-driven

**Files:**
- Modify: `js/data.js`
- Modify: `js/app.js`
- Create: `tests/data.test.js`

**Interfaces:**
- Consumes: validated `Metadata` from Task 1.
- Produces: `loadAll(metadata, fetchImpl) -> Promise<DataStore>`, `buildIndexes(store, metadata) -> DataIndex`, `getYearData(index, year)`, `getScore(index, major, year)`, and `getCollegesByYear(index, year, major)`.

- [ ] **Step 1: Add failing tests** proving source URLs and supported years come only from metadata, missing required files name their path, and a metadata-only 2027 fixture loads without code changes.
- [ ] **Step 2: Run `npm test -- tests/data.test.js`** and verify failures expose the current hard-coded `YEARS`, `FILES` and default 2026 assumptions.
- [ ] **Step 3: Refactor `js/data.js` around `DataStore`/`DataIndex`** while preserving name/code alias matching and the 2026 college fallback declared by metadata.
- [ ] **Step 4: Update `js/app.js`** to load metadata first, then data, and to show metadata/data errors without initializing interactive controls.
- [ ] **Step 5: Run `npm test`** and verify the full suite passes.
- [ ] **Step 6: Commit** the four exact paths with message `refactor: load yearly data from metadata`.

### Task 3: Implement the pure filter, aggregate and sort pipeline

**Files:**
- Create: `js/pipeline.js`
- Create: `tests/pipeline.test.js`

**Interfaces:**
- Consumes: normalized majors, selected-year plan rows, score index, metadata fields and `FilterState`.
- Produces: `validateScoreRange(filters, metadata)`, `buildPreviewRows(input) -> { rows, effectiveSchoolCount }`, and `sortPreviewRows(rows, sort, originalOrder)`.

- [ ] **Step 1: Add failing tests** for AND semantics, all/public/private, all/yes/no poverty status, inclusive score bounds, preset ranges, invalid characters, negatives, reversed bounds, stable original order, score asc/desc and school-count asc/desc.
- [ ] **Step 2: Add the Review Focus aggregation test** proving duplicate rows count once as a school but both contribute to plan totals.
- [ ] **Step 3: Run `npm test -- tests/pipeline.test.js`** and verify failure because the pipeline API is absent.
- [ ] **Step 4: Implement the minimal pure pipeline** with no DOM, storage or download calls.
- [ ] **Step 5: Run `npm test`** and verify all tests pass.
- [ ] **Step 6: Commit** the two exact paths with message `feat: add filter and sort pipeline`.

### Task 4: Render metadata-driven controls and one state owner

**Files:**
- Create: `js/explorer.js`
- Modify: `js/query.js`
- Modify: `js/app.js`
- Modify: `index.html`
- Modify: `css/query.css`
- Delete: `js/table.js`
- Delete: `css/table.css`
- Create: `tests/explorer-state.test.js`

**Interfaces:**
- Consumes: Task 3 pipeline and metadata.
- Produces: `createInitialState(metadata)`, `reduceExplorerState(state, event, metadata)`, `renderExplorerControls(root, metadata, state, dispatch)`, and `setSearchResult(majors, specName)`.

- [ ] **Step 1: Add failing reducer tests** for year changes, filter updates, reset-to-default, page reset after filter/sort, loading and error states.
- [ ] **Step 2: Run `npm test -- tests/explorer-state.test.js`** and verify the reducer module is missing.
- [ ] **Step 3: Implement the state reducer and control renderer**, generating year, enum filters, score presets and sortable options from metadata.
- [ ] **Step 4: Move the preview host below the query result**, remove the separate summary-table tab/static checkboxes, and connect successful searches to `setSearchResult`.
- [ ] **Step 5: Implement input constraints** using `inputmode="numeric"`, digit-only normalization and the pipeline's range validation; disable controls while loading or when no search data exists.
- [ ] **Step 6: Run `npm test`** and manually verify keyboard operation with `python -m http.server 8000`.
- [ ] **Step 7: Commit** only the listed paths with message `feat: add metadata-driven explorer controls`.

### Task 5: Build the paginated metadata-driven preview

**Files:**
- Create: `js/preview.js`
- Create: `css/preview.css`
- Modify: `index.html`
- Modify: `js/explorer.js`
- Create: `tests/preview.test.js`

**Interfaces:**
- Consumes: complete `PreviewRow[]`, metadata table fields, current page and page size.
- Produces: `paginate(rows, page, pageSize)` and `renderPreview(root, model, metadata, dispatch)`; exposes the unpaginated `rows` to export.

- [ ] **Step 1: Add failing tests** for metadata column order, empty results, page boundaries, page reset, last partial page and effective-school statistics.
- [ ] **Step 2: Run `npm test -- tests/preview.test.js`** and verify the preview API is absent.
- [ ] **Step 3: Implement pagination and table rendering**, including loading, initial, filtered-empty and fatal-error states plus horizontal overflow.
- [ ] **Step 4: Add accessible previous/next controls and result summary**, keeping DOM rows limited to the configured page size.
- [ ] **Step 5: Run `npm test`** and manually verify narrow-screen horizontal scrolling.
- [ ] **Step 6: Commit** the five exact paths with message `feat: add paginated result preview`.

### Task 6: Export exactly the complete preview result

**Files:**
- Create: `js/export.js`
- Modify: `js/explorer.js`
- Modify: `index.html`
- Create: `tests/export.test.js`

**Interfaces:**
- Consumes: complete unpaginated `PreviewRow[]`, metadata export fields, selected year and clock.
- Produces: `serializeCsv(rows, fields) -> string`, `buildExportFilename(year, date) -> string`, `downloadCsv(model, documentLike, urlApi)`, and `EXPORTERS = { csv }` as the extension point for a later XLSX implementation.

- [ ] **Step 1: Add failing tests** for metadata header order, preview row order, commas/quotes/newlines, null values, UTF-8 BOM, `院校数据_2027_20261021.csv`, and empty-result rejection.
- [ ] **Step 2: Run `npm test -- tests/export.test.js`** and verify the exporter is absent.
- [ ] **Step 3: Implement CSV serialization and browser download**, using the same field value formatter as preview.
- [ ] **Step 4: Wire the export button** to the complete preview array and disable it for loading/error/empty states.
- [ ] **Step 5: Run `npm test`** and manually compare a filtered/sorted preview with the downloaded CSV.
- [ ] **Step 6: Commit** the four exact paths with message `feat: export the current preview as csv`.

### Task 7: Store only column-width UI preferences and clear all storage

**Files:**
- Create: `js/preferences.js`
- Modify: `js/preview.js`
- Modify: `js/explorer.js`
- Modify: `js/theme.js`
- Create: `tests/preferences.test.js`

**Interfaces:**
- Produces: `readColumnWidths(storage, metadata)`, `writeColumnWidths(storage, widths)`, and `clearPreferences(storage)`. Storage keys are limited to existing `henan-theme` and new `henan-table-widths-v1`.

- [ ] **Step 1: Add failing tests** proving only widths are persisted, malformed JSON falls back safely, unknown field widths are discarded and clear invokes `storage.clear()`.
- [ ] **Step 2: Run `npm test -- tests/preferences.test.js`** and verify the preferences API is absent.
- [ ] **Step 3: Implement preferences and resizable preview columns** with metadata defaults.
- [ ] **Step 4: Wire “清除本地存储”** to clear storage and recreate initial explorer/theme/table state without reloading raw data.
- [ ] **Step 5: Run `npm test`** and inspect the browser Storage panel to confirm no business data keys exist.
- [ ] **Step 6: Commit** the five exact paths with message `feat: persist only table ui preferences`.

### Task 8: Harden loading failures and prove the 2027-only configuration path

**Files:**
- Create: `tests/fixtures/metadata-2027.json`
- Create: `tests/fixtures/scores-2027.json`
- Create: `tests/fixtures/plans-2027.json`
- Create: `tests/integration.test.js`
- Modify: `js/app.js`

**Interfaces:**
- Consumes: public APIs from Tasks 1–7.
- Produces: an integration test that exercises metadata → load → filter → sort → preview model → export without DOM-specific shortcuts.

- [ ] **Step 1: Add a failing 2027 integration test** and a missing-source test that requires the configured path in the user-facing error and keeps export disabled.
- [ ] **Step 2: Run `npm test -- tests/integration.test.js`** and verify the end-to-end test fails at the first uncovered interface.
- [ ] **Step 3: Make only generic fixes** in `js/app.js` or owning modules; do not add the string or number `2027` to production JavaScript.
- [ ] **Step 4: Run `npm test` and `rg -n "2027" js index.html`**; expect all tests to pass and no production-code hits.
- [ ] **Step 5: Commit** the fixture/test paths and any exact generic fix paths with message `test: verify metadata-only year upgrades`.

### Task 9: Final verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `转换说明.md` only if its source-file maintenance steps need the metadata path

**Interfaces:**
- Documents the metadata schema, allowed storage keys, 2027 procedure, test command and CSV behavior.

- [ ] **Step 1: Update documentation** with `npm test`, local server instructions, metadata field/source rules, preview/export identity and the data+metadata-only new-year checklist.
- [ ] **Step 2: Run `npm test`** and require a clean pass with no warnings or failures.
- [ ] **Step 3: Run `node --check` for every `js/*.js` and parse every `data/*.json` plus `metadata/*.json`**; require all files to pass.
- [ ] **Step 4: Serve with `python -m http.server 8000` and verify** loading, one multi-condition filter, each sort direction, reset, clear storage, pagination, empty state, narrow-screen scroll and CSV equality.
- [ ] **Step 5: Run `git diff --check` and `git status --short`**, recording any pre-existing unrelated changes without staging them.
- [ ] **Step 6: Commit only the documentation paths** with message `docs: document metadata-driven data maintenance`.

