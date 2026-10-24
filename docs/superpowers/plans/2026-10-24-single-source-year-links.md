# 年度来源单一事实源实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Make `data/year-links/YYYY.json` the only hand-maintained annual source configuration for crawling, conversion and publication.

**Architecture:** A shared seed loader validates annual source roles and URLs. Crawler and conversion consumers derive deterministic execution targets and canonical paths from the seed; source manifests, extraction reports and catalogs remain generated/audit artifacts. Remove the manually maintained `crawlTargets` contract and migrate every consumer before deleting its tests/docs.

**Tech Stack:** Python 3, standard-library unittest, JSON, GitHub Actions, Node test suite.

**Spec:** `docs/superpowers/specs/2026-10-24-single-source-year-links-design.md`

## Global Constraints

- Use only HTTPS official pages and allowlisted official PDF hosts; never treat a mirror as authority.
- Ambiguous discovery, HTTP 403/412, missing sources, mismatched year/type, and OCR review needs fail closed.
- Preserve existing canonical data, raw PDFs, manual corrections, source manifests and metadata unless an explicitly reviewed annual ingestion publishes new data.
- Preserve 2024/2025 explicit `mappingReferences`; do not change frontend behavior for this migration.
- GitHub Actions checks seeds and uploads reports; it does not auto-publish or merge.

## Review Focus

- Existing 2024–2026 seeds must describe available source pages without falsely implying missing mapping/master raw files are present.
- A seed with one missing role must discover exactly one official page or fail with actionable candidates.
- `--check` and failures must not change canonical files, corrections, registry compatibility artifacts, or metadata.
- Non-contiguous supported years and custom `--data-root` paths must resolve consistently.
- Running legacy CLIs after migration must either work from seed inputs or fail with a clear migration message, never silently use stale registry URLs.

## Files and interfaces

- `crawler/year_sources.py`: seed schema/load/discovery and `crawl_target_for_seed(seed)` stable derived target.
- `crawler/discover.py`, `crawler/download.py`, `crawler/source_rules.py`: accept annual seed paths/years, no URL-bearing `crawlTargets` lookup.
- `convert/ingest_year.py`: shared staging orchestrator remains the single ingestion path.
- `convert/convert_all.py`, `convert/normalize.py`, `convert/issue_reports.py`, `convert/refresh_catalog.py`, `convert/common.py`: consume seed-derived annual targets and conventional data paths; parser records stay cohesive and derived.
- `data/year-links/2024.json`, `2025.json`, `2026.json`: checked-in historical source links and exact known attachments; do not claim end-to-end re-ingestion of already-published years.
- `data/source-registry.json`, `data/README.md`, crawler/convert/root READMEs: remove duplicate manual URL and crawl-target configuration; retain only if a generated, validated compatibility format is still required by audited consumers.
- `.github/workflows/yearly-data.yml`: dispatch/PR use the same seed loader/check path.

### Task 1: Annual seed contract and source fixtures

- [x] Add tests proving the 2024–2026 seed files load, validate year/roles/official hosts, and expose known score-segment and control-line URLs; missing roles resolve only from unique official search candidates.
- [x] Run `python -m unittest crawler.tests.test_year_sources -v` and observe the new seed fixture assertions fail before adding files.
- [x] Add the three seed JSON files using verified official source page URLs and known exact attachments; where an older role cannot yet be verified, record a discovery search URL rather than inventing a page.
- [x] Run the focused tests and record which older-year roles are still undiscovered; do not download/overwrite historical data as part of this task.

### Task 2: Shared derived target and crawler migration

- [x] Add tests proving seed-to-target paths are deterministic and use year-specific manifest/download/extraction/normalized/report paths.
- [x] Change discover/download CLI tests to pass `--seed` (or `--seeds`) and derive targets from year-links; verify off-list links are rejected before network calls.
- [x] Remove `load_crawl_targets` use from crawler runtime and update crawler documentation.
- [x] Run `python -m unittest discover -s crawler/tests`.

### Task 3: Convert/normalize/report migration

- [ ] Add tests proving extract, normalize, issue-report and catalog enumeration read supported annual seeds, not `crawlTargets`.
- [ ] Migrate each consumer to the shared seed-derived target interface; retain parser-specific source rows as an internal derived view only where needed.
- [ ] Add compatibility tests that fail clearly when an old registry-only invocation is attempted.
- [ ] Run `python -m unittest discover -s convert/tests` and verify no canonical data changes.

### Task 4: Remove duplicate registry contract and update docs

- [ ] Add a test that repository runtime code no longer reads `crawlTargets` or hand-maintained source URLs from `source-registry.json`.
- [ ] Remove the duplicate `crawlTargets` data and obsolete registry APIs/docs; keep a generated compatibility file only if Task 3 proves a consumer needs it, and validate it against seeds.
- [ ] Update root, data, crawler, convert documentation and metadata/source-ingestion spec to name year-links as the sole manual input.
- [ ] Run `rg` audit for `crawlTargets`, `source-registry.json`, and old CLI defaults; remaining references must be generated compatibility/tests/history only and explained.

### Task 5: Action and end-to-end acceptance

- [ ] Test PR and workflow-dispatch paths both pass the selected seed(s) into the same `convert.ingest_year --check` code path.
- [ ] Verify 2024–2026 seed-only offline target derivation and the synthetic 2027 full ingest/publication flow, including fail-closed 412 and metadata byte identity.
- [ ] Run crawler and convert suites, `npm test`, workflow YAML parsing and `git diff --check`.
- [ ] Compare hashes of existing canonical files, raw PDFs, manual corrections, source manifests and metadata before/after; commit the seed migration in reviewable batches.
