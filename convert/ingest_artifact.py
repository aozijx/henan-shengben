"""Export and safely apply the data portion of a checked annual ingest."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path, PurePosixPath

from convert.common import write_json


def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def export_staged_changes(staging_root: Path, data_root: Path, export_dir: Path,
                          seed_path: Path, year: int, *, complete: bool = True) -> None:
    """Copy only new non-catalog data files from a successful check into an artifact tree."""
    staging_root = Path(staging_root).resolve()
    data_root = Path(data_root).resolve()
    export_dir = Path(export_dir).resolve()
    if export_dir.is_relative_to(data_root) or export_dir.is_relative_to(staging_root):
        raise ValueError('artifact export directory must be outside data and staging roots')
    if export_dir.exists() and any(export_dir.iterdir()):
        raise ValueError(f'artifact export directory is not empty: {export_dir}')
    export_dir.mkdir(parents=True, exist_ok=True)

    files = []
    for source in sorted(staging_root.rglob('*')):
        if not source.is_file():
            continue
        if source.is_symlink():
            raise ValueError(f'checked ingest contains a symlink: {source}')
        relative = source.relative_to(staging_root)
        if relative.parts[0] == 'generated':
            # The post-merge publisher regenerates analytics, catalog, and metadata cheaply.
            continue
        target = data_root / relative
        content = source.read_bytes()
        if target.exists():
            if target.read_bytes() != content:
                raise ValueError(f'checked ingest would overwrite existing file: {relative.as_posix()}')
            continue
        repo_path = PurePosixPath('data', *relative.parts).as_posix()
        artifact_file = export_dir / Path(*PurePosixPath(repo_path).parts)
        artifact_file.parent.mkdir(parents=True, exist_ok=True)
        artifact_file.write_bytes(content)
        files.append({'path': repo_path, 'sha256': _digest(content), 'bytes': len(content)})

    if not files:
        raise ValueError(f'{year}: checked ingest produced no new data files to export')
    seed_content = Path(seed_path).read_bytes()
    write_json(export_dir / 'manifest.json', {
        'schemaVersion': 1,
        'year': year,
        'seedPath': f'data/year-links/{year}.json',
        'seedSha256': _digest(seed_content),
        'complete': bool(complete),
        'files': files,
    }, indent=2)


def package_run_manifest(artifact_root: Path, repository: str, pr_number: int,
                         pr_head_sha: str, run_id: int, seeds_file: Path) -> None:
    artifact_root = Path(artifact_root).resolve()
    years = []
    complete_years = []
    for raw in Path(seeds_file).read_text(encoding='utf-8').splitlines():
        if not raw.strip():
            continue
        seed = PurePosixPath(raw.strip())
        if seed.parts[:2] != ('data', 'year-links') or seed.suffix != '.json' or not seed.stem.isdigit():
            raise ValueError(f'invalid yearly seed path in changed-seeds file: {raw!r}')
        year = int(seed.stem)
        manifest_path = artifact_root / str(year) / 'manifest.json'
        if not manifest_path.is_file():
            raise ValueError(f'missing exported artifact manifest for {year}')
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('year') != year or manifest.get('seedPath') != seed.as_posix():
            raise ValueError(f'exported artifact does not match seed {seed.as_posix()}')
        years.append(year)
        if manifest.get('complete') is True:
            complete_years.append(year)
    if not years or len(years) != len(set(years)):
        raise ValueError('changed-seeds must contain one or more unique yearly seeds')
    write_json(artifact_root / 'run.json', {
        'schemaVersion': 1,
        'repository': repository,
        'prNumber': pr_number,
        'prHeadSha': pr_head_sha,
        'workflowRunId': run_id,
        'years': sorted(years),
        'completeYears': sorted(complete_years),
    }, indent=2)


def apply_checked_artifact(artifact_root: Path, repo_root: Path, repository: str,
                           pr_number: int, pr_head_sha: str, run_id: int,
                           applied_paths_file: Path, seeds_file: Path) -> list[str]:
    artifact_root = Path(artifact_root).resolve()
    repo_root = Path(repo_root).resolve()
    run_manifest = json.loads((artifact_root / 'run.json').read_text(encoding='utf-8'))
    expected = {
        'schemaVersion': 1,
        'repository': repository,
        'prNumber': pr_number,
        'prHeadSha': pr_head_sha,
        'workflowRunId': run_id,
    }
    for key, value in expected.items():
        if run_manifest.get(key) != value:
            raise ValueError(f'artifact {key} does not match the merged pull request')

    years = run_manifest.get('years')
    if not isinstance(years, list) or not years or any(not isinstance(year, int) for year in years):
        raise ValueError('artifact contains an invalid year list')
    pushed_years = []
    for raw in Path(seeds_file).read_text(encoding='utf-8').splitlines():
        if raw.strip():
            seed = PurePosixPath(raw.strip())
            if seed.parts[:2] != ('data', 'year-links') or seed.suffix != '.json' or not seed.stem.isdigit():
                raise ValueError(f'invalid pushed yearly seed path: {raw!r}')
            pushed_years.append(int(seed.stem))
    if (len(years) != len(set(years)) or len(pushed_years) != len(set(pushed_years))
            or sorted(years) != sorted(pushed_years)):
        raise ValueError('checked artifact years do not match the seed files merged to main')
    copies: list[tuple[Path, Path, bytes, str]] = []
    seen_paths = set()
    for year in years:
        year_root = artifact_root / str(year)
        manifest = json.loads((year_root / 'manifest.json').read_text(encoding='utf-8'))
        seed_path = f'data/year-links/{year}.json'
        if manifest.get('year') != year or manifest.get('seedPath') != seed_path:
            raise ValueError(f'artifact manifest does not match year {year}')
        current_seed = repo_root / Path(*PurePosixPath(seed_path).parts)
        if not current_seed.is_file() or _digest(current_seed.read_bytes()) != manifest.get('seedSha256'):
            raise ValueError(f'merged seed differs from the seed that produced year {year}')
        files = manifest.get('files')
        if not isinstance(files, list) or not files:
            raise ValueError(f'artifact has no data files for {year}')
        for item in files:
            relative_text = item.get('path') if isinstance(item, dict) else None
            if not isinstance(relative_text, str) or '\\' in relative_text:
                raise ValueError('artifact contains an invalid repository path')
            relative = PurePosixPath(relative_text)
            if (not relative.parts or relative.is_absolute() or relative.parts[0] != 'data'
                    or len(relative.parts) < 3 or '..' in relative.parts
                    or relative.parts[1] not in {
                        '一分一段', '来源清单', '专业对照', '招生高校及专业',
                        '招生计划', '省控线', 'reports',
                    }
                    or '.git' in relative.parts):
                raise ValueError(f'artifact path is outside the allowed data outputs: {relative_text}')
            if relative_text in seen_paths:
                raise ValueError(f'artifact repeats a repository path: {relative_text}')
            seen_paths.add(relative_text)
            source = year_root.joinpath(*relative.parts)
            if not source.resolve().is_relative_to(year_root):
                raise ValueError(f'artifact path escapes its root: {relative_text}')
            current = year_root
            for part in relative.parts:
                current = current / part
                if current.is_symlink():
                    raise ValueError(f'artifact contains a symlink: {relative_text}')
            content = source.read_bytes()
            if len(content) != item.get('bytes') or _digest(content) != item.get('sha256'):
                raise ValueError(f'artifact file failed its checksum: {relative_text}')
            destination = repo_root.joinpath(*relative.parts)
            if destination.is_symlink():
                raise ValueError(f'merged repository contains a symlink at {relative_text}')
            if destination.exists() and destination.read_bytes() != content:
                raise ValueError(f'merged repository already has different data at {relative_text}')
            copies.append((source, destination, content, relative_text))

    # Preflight the complete artifact before applying any file.
    applied = []
    for _, destination, content, relative_text in copies:
        if destination.exists():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + '.new')
        temporary.write_bytes(content)
        os.replace(temporary, destination)
        applied.append(relative_text)
    Path(applied_paths_file).write_text(''.join(f'{path}\n' for path in applied), encoding='utf-8')
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    package = commands.add_parser('package')
    package.add_argument('--root', type=Path, required=True)
    package.add_argument('--repository', required=True)
    package.add_argument('--pr-number', type=int, required=True)
    package.add_argument('--pr-head-sha', required=True)
    package.add_argument('--run-id', type=int, required=True)
    package.add_argument('--seeds-file', type=Path, required=True)
    apply = commands.add_parser('apply')
    apply.add_argument('--root', type=Path, required=True)
    apply.add_argument('--repo-root', type=Path, default=Path.cwd())
    apply.add_argument('--repository', required=True)
    apply.add_argument('--pr-number', type=int, required=True)
    apply.add_argument('--pr-head-sha', required=True)
    apply.add_argument('--run-id', type=int, required=True)
    apply.add_argument('--applied-paths-file', type=Path, required=True)
    apply.add_argument('--seeds-file', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'package':
        package_run_manifest(args.root, args.repository, args.pr_number,
                             args.pr_head_sha, args.run_id, args.seeds_file)
        return 0
    applied = apply_checked_artifact(args.root, args.repo_root, args.repository,
                                     args.pr_number, args.pr_head_sha, args.run_id,
                                     args.applied_paths_file, args.seeds_file)
    print(f'Applied {len(applied)} checked data files')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
