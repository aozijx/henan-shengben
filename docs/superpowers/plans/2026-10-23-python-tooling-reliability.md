# Python Tooling Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make batch conversion executable and make crawler downloads fully registry-driven.

**Architecture:** Keep extraction/parsing untouched. Repair the conversion IO boundary and introduce one download orchestration function that obtains manifests from the shared registry loader rather than a filename glob.

**Tech Stack:** Python 3, standard-library `unittest`, `requests` session injection, JSON registry.

**Spec:** `docs/superpowers/specs/2026-10-23-python-tooling-reliability-design.md`

## Global Constraints

- Do not change OCR, PDF parsing, normalization, or committed business JSON.
- Use the shared registry as the only source of crawl target paths and years.
- Preserve existing PDFs on failed downloads; tests must not use the network.
- Stage exact paths only; `.superpowers/` stays ignored and uncommitted.

## Review Focus

- Empty manifest: conversion writes a valid zero-entry output rather than raising a name error.
- Partial year selection: download only touches the selected target manifest.
- Registry-only contract: unrelated JSON files in the manifest directory are ignored.
- CLI defaults: no `--years` still processes every declared target.
- Failed HTTP/non-PDF response: existing PDF content remains unchanged.

---

### Task 1: Repair the conversion IO boundary

**Files:**

- Modify: `convert/convert_all.py:57-90`
- Create: `convert/tests/test_convert_all.py`

**Interfaces:**

- Consumes: `read_json(path: Path) -> Any`, `write_json(path: Path, value: object) -> None`
- Produces: `convert_target(target, data_root, major_codes=None, workers=1) -> dict[str, Any]`

- [x] **Step 1: Write the failing conversion test**
- [x] **Step 2: Run it to verify it fails with the undefined helper error**
- [x] **Step 3: Replace private helper calls with the imported JSON functions**
- [x] **Step 4: Run conversion tests to verify the test passes**

### Task 2: Make downloads registry-driven

**Files:**

- Modify: `crawler/download.py:1-59`
- Modify: `crawler/tests/test_download.py`

**Interfaces:**

- Consumes: `load_crawl_targets(registry_path: Path, years: set[int] | None) -> list[CrawlTarget]`
- Produces: `download_targets(registry_path: Path, data_root: Path, years: set[int] | None, session) -> dict[int, dict[str, int]]`

- [x] **Step 1: Write failing tests for year selection and ignoring unrelated manifests**
- [x] **Step 2: Run crawler tests to verify the missing orchestration function fails**
- [x] **Step 3: Implement registry target orchestration and CLI forwarding**
- [x] **Step 4: Run crawler tests to verify the target contract passes**

### Task 3: Update documentation and run cross-project verification

**Files:**

- Modify: `convert/README.md`
- Modify: `crawler/README.md`

- [x] **Step 1: Document registry-driven download commands and year selection**
- [x] **Step 2: Run syntax, Python, and application regressions**
- [ ] **Step 3: Commit exact implementation and documentation paths**
