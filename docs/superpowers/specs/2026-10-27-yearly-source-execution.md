# Yearly Source Execution

## Goal

Make each annual command process only the source roles declared by that year's seed, and make discovery, download, conversion, and catalog generation agree on the same optional-source rules.

## Source Rules

- `data/year-links/YYYY.json` is the source of truth for declared roles.
- An undeclared role produces no network discovery/download target and is skipped without network access. Existing local files may still be consumed by the established offline conversion paths.
- A declared role with an explicit official `pageUrl` uses that page. A declared role without `pageUrl` may use the seed's `searchPageUrl` to find a candidate.
- A successful search with no candidate means that source is not published yet and is skipped. Multiple candidates, invalid official hosts, inaccessible explicit pages, wrong year/type, or invalid attachments remain explicit errors.
- Score-segment discovery creates a manifest only after a usable page is found. Download skips absent targets and manifests; it never fabricates a target from a generic search URL.
- Partial-year ingestion may export declared sources, but it does not refresh catalog/metadata until the existing completeness rules are met.

## Shared Execution Plan

Derive optional score-segment targets and tabular source rows through one plan builder. `discover.py`, `download.py`, `convert.ingest_year`, conversion/catalog readers, and GitHub Actions must consume that plan instead of independently inferring that every seed has a score-segment dataset.

## Official-Site Session

- The WAF client is serialized and safe when called by download worker threads.
- Browser cookie capture is provisional. Persist a new cookie only after the original HTTP request succeeds on retry; preserve the prior cookie if retry is still blocked.
- Report initial status, browser page validation, and retry status without logging cookie values.
- Keep OCR/extraction parallelism independent from network request pacing.

## Compatibility

Keep existing CLI entry points and flags. Preserve explicit source validation and the current official-host allowlist. Do not alter existing annual source manifests, PDFs, canonical data, or metadata as part of this refactor.

## Acceptance

- A seed containing only `mappingCodeTable` is accepted by discover/download without requesting a score-segment search page or requiring a score-segment manifest; existing local conversion paths remain available.
- Declared score-segment sources continue to resolve and run through the same target paths as before.
- A missing/unpublished optional source is skipped; an ambiguous or invalid declared source still reports a useful error.
- A blocked browser-derived cookie is not persisted; a cookie is persisted only after the HTTP retry is accepted.
- Existing CLI entry points and partial-year ingestion behavior remain covered by tests.
