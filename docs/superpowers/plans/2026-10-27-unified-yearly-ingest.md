# Unified Yearly Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all yearly crawl and conversion commands agree on which source roles exist and safely share official-site requests.

**Architecture:** `data/year-links/YYYY.json` remains the only manually maintained source list. A shared optional score-segment target builder feeds crawler commands and the existing data plan; absent sources and absent manifests are skips, while invalid or ambiguous declared sources retain explicit failures. `WafSession` serializes requests, validates browser-derived credentials with the original request, and persists them only after the retry is accepted.

**Tech Stack:** Python 3, requests, DrissionPage, unittest.

**Spec:** `docs/superpowers/specs/2026-10-27-yearly-source-execution.md`

## Global Constraints

- Do not change existing seed URLs, manifests, PDFs, normalized data, or metadata.
- Keep current CLI names, arguments, official-host allowlist, and per-year paths.
- Missing source roles do not fail a year; malformed or ambiguous declared roles still fail clearly.
- Never print or commit Cookie or User-Agent credentials.
- Network fetching stays serialized; OCR and parsing parallelism remains independently configurable.

## Review Focus

- A seed with only mapping sources never creates a score-segment target.
- A declared score-segment role without a direct page may search; zero candidates skips and multiple candidates fail clearly.
- Missing manifests do not cause an uncaught file error or overwrite existing data.
- A blocked retry does not replace a previously usable `.waf-cookie`.
- Concurrent download workers cannot race bootstrap state or issue overlapping requests through one session.

---

### Task 1: Make Optional Score-Segment Targets a Shared Source Rule

**Files:**
- Modify: `crawler/year_sources.py`
- Test: `crawler/tests/test_year_sources.py`, `crawler/tests/test_discover.py`

**Interfaces:**
- `score_segment_target_for_seed(seed: dict) -> CrawlTarget | None` returns no target when the seed has no `scoreSegments` role.
- `load_seed_targets(...)` and `build_data_plan(...)` include only declared score-segment sources.
- `resolve_score_segment_target(seed, session) -> CrawlTarget | None` returns `None` for an unpublished source, one target for one candidate, and an explicit error for ambiguity.

- [x] Add tests for undeclared roles, zero search candidates, one candidate, and multiple candidates.
- [x] Run the focused tests and confirm the new absent-source tests fail first.
- [x] Implement the shared target builder and remove duplicate implicit target creation.
- [x] Run `python -m unittest crawler.tests.test_year_sources crawler.tests.test_discover`.

### Task 2: Route Discover and Download Through the Shared Target Plan

**Files:**
- Modify: `crawler/discover.py`, `crawler/download.py`
- Test: `crawler/tests/test_discover.py`, `crawler/tests/test_download.py`

**Interfaces:**
- `discover.py` skips undeclared roles before network access and skips a successful search with no matching announcement.
- `download_targets(...)` consumes only planned targets and skips missing manifests with a concise status.

- [x] Test that 2027 mapping-only seeds cause no search or download request and no missing-manifest exception.
- [x] Test that a declared target with a manifest still downloads the selected entries.
- [x] Implement both CLIs using the shared target derivation.
- [x] Run `python -m unittest crawler.tests.test_discover crawler.tests.test_download` and `python crawler/discover.py --years 2027`, `python crawler/download.py --years 2027`.

### Task 3: Align Conversion and Catalog Plans

**Files:**
- Modify: `crawler/year_sources.py`, `convert/common.py` only if needed
- Test: `crawler/tests/test_annual_sources.py` or existing annual-plan test module, `convert/tests/test_ingest_year.py`

**Interfaces:**
- `build_data_plan(...)` returns table parser rows only for declared/available source inputs and score-segment targets only for declared score-segment roles.
- Partial ingestion remains partial: declared files can be exported, but incomplete years do not refresh catalog/metadata.

- [x] Add a mapping-only seed assertion that no score-segment target appears in the data plan.
- [x] Verify existing partial-ingest and metadata-preservation tests still cover this contract.
- [x] Remove any remaining unconditional score-segment target derivation in conversion/catalog consumers.
- [x] Run the relevant annual-source, ingest, normalize, and catalog tests.

### Task 4: Make WAF Bootstrap Transactional and Thread-Safe

**Files:**
- Modify: `crawler/waf.py`, `pipeline_config.py`
- Test: `crawler/tests/test_waf.py`, `crawler/tests/test_download.py`

**Interfaces:**
- `bootstrap_cookie(url) -> dict | None` returns candidate credentials without persisting them.
- `WafSession.get(...)` serializes request/bootstrap/retry; it commits credentials only if the retry is no longer WAF-blocked, otherwise it restores the previous headers and cookie file.
- `DOWNLOAD_WORKERS` defaults to `1` for official PDF fetching; OCR workers are unchanged.

- [x] Add tests that a successful retry persists candidate credentials, a blocked retry preserves the previous cookie, a retry exception restores headers, and simultaneous calls share one bootstrap.
- [x] Run the tests red before implementation.
- [x] Implement transactional cookie persistence, lock-protected WAF state, and sequential official downloads.
- [x] Run `python -m unittest crawler.tests.test_waf crawler.tests.test_download`.

### Task 5: Document the Unified Workflow and Run the Full Verification Set

**Files:**
- Modify: `crawler/README.md`, `convert/README.md`
- Test: all `crawler/tests` and `convert/tests`

- [x] Document source-optional behavior, command order, no-op cases, and WAF retry confirmation.
- [x] Run `python -m unittest discover -s crawler/tests`.
- [x] Run `python -m unittest discover -s convert/tests`.
- [x] Run `git diff --check` and inspect the final diff, preserving existing annual data/PDF changes.
