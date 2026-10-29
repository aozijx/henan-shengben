"""Compatibility exports for annual source planning and resolution."""
from __future__ import annotations

from crawler.source_rules import CrawlTarget
from crawler.source_plan import (
    PDF_MARKERS,
    SOURCE_ROLES,
    TABLE_PDF_PATHS,
    TABLE_SOURCE_SPECS,
    SourceResolutionError,
    build_data_plan,
    crawl_target_record,
    load_year_links,
    score_segment_target_for_seed,
    seed_paths_in,
    source_rows_for_seed,
)
from crawler.source_resolution import (
    execution_rows_for_year,
    resolve_score_segment_target,
    resolve_year_sources,
    validate_attachment,
)
