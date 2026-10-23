# Yearly Source Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, link-seeded new-year ingestion command that discovers official files, builds the existing yearly data/indexes, and updates metadata only after strict validation.

**Architecture:** A yearly link file is the only new-year hand-edited configuration. Small crawler modules resolve official source candidates and download them into staging; conversion modules reuse existing parsers; a prepublication gate checks coverage, then the orchestrator promotes canonical data and calls the existing versioned catalog publisher. GitHub Actions invokes the same command and exposes a reviewable diff without auto-merging.

**Tech Stack:** Python 3, `requests`, BeautifulSoup, pdfplumber, standard-library `unittest`, JSON, existing JavaScript frontend and Node test suite, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-yearly-source-ingestion-design.md`

## Global Constraints

- New years use their own mapping; preserve only the existing explicit old-year `mappingReferences`.
- Search results and school mirrors are discovery hints, never authority; ambiguous, inaccessible or incomplete official sources fail closed. Verified official PDF hosts include `xcoss.henan.gov.cn` in addition to examination-agency hosts.
- No existing canonical JSON, PDF or manual correction is overwritten by the new-year default command.
- Keep the existing `yearSources` and analytics/index/shard contract; do not add a per-year UI branch.
- Metadata is the final published pointer; no automatic merge or publication with unresolved OCR issues.
- Network tests use injected sessions and local fixtures, not live official-site requests.

## Review Focus

- An official page returning an HTML anti-bot response (including HTTP 412) produces a visible failure and leaves metadata untouched: Task 1 and Task 5 tests.
- Two plausible same-year announcements for one required type are reported as ambiguity, not silently ranked: Task 1 test.
- A permitted PDF URL redirected to an untrusted host is rejected before file replacement: Task 2 test.
- One missing score-segment PDF amid otherwise valid data fails the coverage gate: Task 4 test.
- A repeat run encountering existing manual corrections or canonical files refuses to overwrite them: Task 5 test.

---

## File structure and responsibilities

- `data/year-links/YYYY.json`: the one hand-edited, year-specific source seed; do not add a real 2027 file until actual official URLs exist.
- `crawler/year_sources.py`: schema validation, official announcement discovery, candidate classification, provenance, and deterministic registry rows.
- `crawler/discover.py`, `crawler/source_rules.py`: reuse the segment attachment extractor and centralize official URL rules.
- `crawler/download.py`: safe PDF download and final-URL/path validation.
- `convert/extract_cli.py`: reusable registered-source extraction that works when output JSON does not yet exist.
- `convert/refresh_catalog.py`: shared year completeness validation and versioned publication; its analytics/shard format stays stable.
- `convert/ingest_year.py`: staged new-year orchestration and a small CLI; it does not reimplement parsers.
- `.github/workflows/yearly-data.yml`: run the same command in verification mode and upload the source/coverage/diff report for review.
- `crawler/README.md`, `convert/README.md`, `data/README.md`: maintainers' source-link, correction, rerun and release procedure.

### Task 1: Year-link contract and fail-closed discovery

**Files:**
- Create: `crawler/year_sources.py`
- Create: `crawler/tests/test_year_sources.py`
- Modify: `crawler/discover.py`
- Modify: `crawler/source_rules.py`

**Interfaces:**
- Produces: `load_year_links(path: Path) -> dict` with `year`, optional `searchPageUrl`, and a `sources` map keyed by `scoreSegments`, `scorelines`, `plans`, `mappingCodeTable`, `mappingOverview`, `master`; each source contains an optional `pageUrl` and optional `attachmentUrl`. Missing links may be discovered, but all six roles must resolve before download.
- Produces: `resolve_year_sources(seed: dict, session) -> dict` (one official page per required type, discovered official attachments and provenance; raises `DiscoveryBlockedError` on missing/ambiguous source).
- Produces: `registry_rows_for_year(resolved: dict) -> tuple[list[dict], dict]` (existing `sources` rows including `招生高校及专业`, plus one score-segments `crawlTargets` row, with conventional year paths and no `expectedCount` guess).

- [ ] **Step 1: Write failing tests** for supplied 2026 seed URLs, exact year/type match, duplicate candidate announcements, missing required links, the official `xcoss.henan.gov.cn` attachment host, and HTML anti-bot page. Assert that ambiguous/missing cases raise and that registry rows have year-specific mapping and conventional output paths.
- [ ] **Step 2: Run `python -m unittest crawler.tests.test_year_sources -v`**; expect the new interfaces to be unavailable.
- [ ] **Step 3: Implement seed schema and source resolution.** A declared exact page wins only after official-host/year/type validation; search may supply a candidate only when it is unique. Parse official page links by their visible title and URL, never by filename alone; treat unsupported HTML-only tables or changed attachment formats as a precise failure pending parser support. Reuse `discover_year` for score-segment attachments; add an explicit fetched-page base URL for direct official pages, while leaving the legacy registry crawler's current behavior compatible. Mirror-relative URLs alone cannot establish an official attachment.
- [ ] **Step 4: Run the task tests and existing `crawler.tests.test_discover`**; expect all to pass.
- [ ] **Step 5: Commit exact Task 1 files** with the tests and a short source contract note in `crawler/README.md`.

### Task 2: Safe attachment download and provenance

**Files:**
- Modify: `crawler/download.py`
- Modify: `crawler/source_rules.py`
- Modify: `crawler/tests/test_download.py`

**Interfaces:**
- Consumes: resolved official PDF URLs from Task 1.
- Produces: `download_entry(url: str, target: Path, session, expected_sha256: str | None = None) -> dict` retaining current status/hash/bytes keys, adding final URL for provenance.
- Produces: `download_manifest(manifest_path: Path, data_root: Path, session) -> dict[str, int]` with path containment and duplicate-destination checks.

- [ ] **Step 1: Write failing tests** for offsite redirect, on-site redirect, invalid PDF/HTML response, traversal path, duplicate local path and failed download preserving an existing file. Assert final URL/hash are recorded only on successful downloads.
- [ ] **Step 2: Run `python -m unittest crawler.tests.test_download -v`**; expect the new safety cases to fail.
- [ ] **Step 3: Implement URL checks before and after redirect, resolved-path containment, duplicate detection and atomic replacement.** Keep the current registry-driven year selection and return a nonzero CLI exit on any failed entry.
- [ ] **Step 4: Run `python -m unittest discover -s crawler/tests -v`**; expect all to pass.
- [ ] **Step 5: Commit exact Task 2 files** with tests.

### Task 3: Extract a brand-new registered year without overwriting old data

**Files:**
- Modify: `convert/extract_cli.py`
- Create: `convert/tests/test_extract_cli.py`
- Modify: `convert/README.md`

**Interfaces:**
- Produces: `extract_registered_year(registry: dict, data_root: Path, year: int, *, write: bool, parser: str | None = None) -> list[dict]` using `extract_entry` and returning parser, output path, row count and diff status per source.
- CLI delegates to the function, preserving `--year`, `--parser` and `--write` behavior for established years.

- [ ] **Step 1: Write failing tests** for new-year missing output JSON (permitted only with `write=True`), existing-year dry-run diff, wrong-year registry rows ignored, optional `expectedCount`, and refusal to overwrite an existing output in the new-year ingestion path.
- [ ] **Step 2: Run `python -m unittest convert.tests.test_extract_cli -v`**; expect new-year extraction to fail at `read_json(output_path)`.
- [ ] **Step 3: Factor the extraction loop into `extract_registered_year`, read existing JSON only if present, and keep the current human-readable CLI diff.** `ingest_year` will call this against staging, so existing outputs in the real data root are never written by default.
- [ ] **Step 4: Run `python -m unittest discover -s convert/tests -v`**; expect all to pass.
- [ ] **Step 5: Commit exact Task 3 files** with documentation.

### Task 4: Enforce complete yearly coverage before catalog publication

**Files:**
- Modify: `convert/refresh_catalog.py`
- Modify: `convert/tests/test_refresh_catalog.py`

**Interfaces:**
- Produces: `validate_year_sources(year: int, files: dict, canonical: dict, report: dict, data_root: Path, manifest: dict | None = None) -> None` by extracting the existing `_validate_sources` logic and strengthening it.
- `refresh_catalog(...) -> dict` keeps its existing signature and calls that validator; existing `mappingReferences` for 2024/2025 remain valid.

- [x] **Step 1: Write failing tests** proving a missing segment for a scoreline, duplicate manifest major code, mismatched manifest/extraction/report counts, and an undocumented official-empty exception reject publication without changing metadata. Keep the valid synthetic 2027 and old-year mapping-reference cases passing; also prove an unchanged previously published legacy snapshot is retained while any changed input is revalidated.
- [x] **Step 2: Run `python -m unittest convert.tests.test_refresh_catalog -v`**; duplicate-manifest test failed before implementation and passed after.
- [x] **Step 3: Extract `validate_year_sources(...)` and require `scoreline_codes == segment_codes` except explicit, evidenced official-empty codes; check manifest completeness and report totals.** Preserve the existing historical 2026 `N8` exception (official empty but absent from scorelines); exceptions are year-scoped records, not global code allowlists.
- [x] **Step 4: Run `python -m unittest convert.tests.test_refresh_catalog -v`** and full convert tests; all pass.
- [x] **Step 5: Commit exact Task 4 files** with tests.

### Task 5: Stage, validate and publish one new year

**Files:**
- Create: `convert/ingest_year.py`
- Create: `convert/tests/test_ingest_year.py`
- Modify: `convert/README.md`
- Modify: `data/README.md`

**Interfaces:**
- Produces: `ingest_year(seed_path: Path, data_root: Path, template_path: Path, metadata_path: Path, session, *, check: bool = False) -> dict`.
- CLI: `python -m convert.ingest_year --seed data/year-links/YYYY.json [--check]`; `--check` creates a report/diff without publishing, default execution publishes only after validation.
- Consumes Task 1 source/registry output, Task 2 safe downloader, Task 3 registered extraction, existing `convert_target`/`normalize_target`, Task 4 validation, and `refresh_catalog`.

- [x] **Step 1: Write tests** with synthetic 2027 source pages/PDF fixtures and injected session/mocked PDF parsers: successful run adds 2027 to metadata and stable shard paths, check replay is idempotent, 412/missing PDF/OCR needs-review leaves metadata byte-identical, and existing canonical/manual corrections cause refusal rather than overwrite.
- [x] **Step 2: Run `python -m unittest convert.tests.test_ingest_year -v`**; the orchestrator already exists from earlier commits, so verify the missing acceptance coverage rather than expecting the interface to be unavailable.
- [x] **Step 3: Implement the staged pipeline.** New-year downloads, registry rows, canonical JSON and reports use staging. `--check` refreshes a temporary copy and never writes the active data root; publication promotes validated new-year files, merges registry, then invokes `refresh_catalog` last.
- [x] **Step 4: Run the new tests, all Python tests and `npm test`**; all pass and the synthetic year loads without JS changes.
- [x] **Step 5: Document the exact local command, source-link schema, anti-bot/offline-input failure path, correction review, rerun and rollback procedure; commit exact Task 5 files plus design/plan docs.**

### Task 6: Add review-only GitHub automation

**Files:**
- Create: `.github/workflows/yearly-data.yml`
- Create: `crawler/tests/test_yearly_workflow.py`
- Modify: `data/README.md`

**Interfaces:**
- Consumes Task 5 `--check` mode for one changed `data/year-links/YYYY.json`.
- Produces an uploaded source/coverage/diff artifact for PR review; the workflow does not commit or merge data.

- [ ] **Step 1: Write failing workflow contract tests** asserting the workflow uses read-only permissions, targets link-file changes, runs `python -m convert.ingest_year --check`, uploads the report even on a failed ingest, and has no push/merge step.
- [ ] **Step 2: Run `python -m unittest crawler.tests.test_yearly_workflow -v`**; expect missing workflow failure.
- [ ] **Step 3: Add the workflow with pinned Python/Node setup and dependency installation, run Python/JS tests plus the local check command, and upload review artifacts.** Describe that official-site 403/412 is a reviewable failure, not a fallback to unverified mirrors. Generated-data commits remain a human-reviewed local step until CI network reliability and bot permissions are proven.
- [ ] **Step 4: Run the workflow contract test and full local test suites; validate workflow YAML syntax with the repository's available validator if present.**
- [ ] **Step 5: Commit exact workflow/test/documentation files.**

### Task 7: Include the official admissions master list in each new-year ingestion

**Files:**
- Modify: `crawler/year_sources.py`
- Modify: `crawler/source_rules.py`
- Modify: `crawler/tests/test_year_sources.py`
- Modify: `convert/ingest_year.py` and create `convert/tests/test_ingest_year.py` for parser-to-source provenance mapping; the current orchestrator indexes only `scorelines`/`plans` and `mapping`, so a `master` row currently fails.
- Modify: this plan and `docs/superpowers/specs/2026-10-23-yearly-source-ingestion-design.md`

**Reason:** 2026 already publishes a separate `招生高校及专业_2026.json` from the official `招生高校及专业总表`; the annual ingestion contract currently has no role for this dataset. The 2026 PDF is officially hosted on `xcoss.henan.gov.cn`, also absent from the URL allowlist.

- [x] **Step 1: Write failing tests** asserting `master` is required, a `xcoss.henan.gov.cn` official attachment passes validation while an unrelated mirror fails, and `registry_rows_for_year` emits the conventional master JSON/PDF row with parser `master`.
- [x] **Step 2: Run `python -m unittest crawler.tests.test_year_sources -v`**; the new assertions failed first for the missing role/host/row.
- [x] **Step 3: Implement the smallest contract update** by adding the source role/markers, allowing the verified government attachment host, and emitting the existing `招生高校及专业` registry row. Reuse the current parser and staged ingestion path; do not special-case 2026 or change UI behavior.
- [x] **Step 4: Run the source resolver and ingestion tests, then all Python tests**; metadata publication remains in staging until complete; no existing-year files were changed.
- [x] **Step 5: Document the six-role source contract and commit exact files.**

## Final verification

- [x] `python -m unittest discover -s crawler/tests -v`
- [x] `python -m unittest discover -s convert/tests -v`
- [x] `npm test` (133/133; after `npm ci` installed locked dev dependencies)
- [x] Run synthetic 2027 end-to-end tests; inspect source hashes, yearly mapping, coverage report, analytics/index/shards and metadata diff.
- [ ] Run the full 2026 offline PDF-to-OCR replay (the 186-PDF attempt was interrupted); catalog-only replay from committed normalized data was successful and preserved `yearSources`.
- [x] Check `git diff --check`, exact staged paths and existing-year file hashes; do not claim live official-site ingestion without a successful network run.
