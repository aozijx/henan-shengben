import json
import tempfile
import unittest
from pathlib import Path

from convert.ingest_artifact import (
    apply_checked_artifact,
    export_staged_changes,
    package_run_manifest,
)


class IngestArtifactTests(unittest.TestCase):
    def test_manual_artifact_can_be_bound_to_merged_pr_and_applied(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / 'repo'
            data = repo / 'data'
            seed = data / 'year-links' / '2027.json'
            seed.parent.mkdir(parents=True)
            seed.write_bytes(b'{"year":2027}\n')
            (data / '一分一段').mkdir()
            (data / '一分一段' / '人工修正.json').write_text('{"corrections":[]}\n', encoding='utf-8')

            staging = root / 'staging'
            (staging / '一分一段').mkdir(parents=True)
            (staging / '一分一段' / '人工修正.json').write_bytes(
                (data / '一分一段' / '人工修正.json').read_bytes())
            generated = staging / '专业对照' / '原始PDF' / '专业对照_2027.pdf'
            generated.parent.mkdir(parents=True)
            generated.write_bytes(b'%PDF synthetic checked source')
            derived = staging / 'generated' / '2027' / 'catalog.json'
            derived.parent.mkdir(parents=True)
            derived.write_text('{}\n', encoding='utf-8')

            artifact_root = root / 'artifact' / '2027'
            export_staged_changes(staging, data, artifact_root, seed, 2027)
            seeds_file = root / 'changed-seeds.txt'
            seeds_file.write_text('data/year-links/2027.json\n', encoding='utf-8')
            pr_sha = 'a' * 40
            run_id = 8123
            package_run_manifest(artifact_root.parent, 'owner/repo', 42, pr_sha, run_id, seeds_file)
            applied_paths = root / 'applied-paths.txt'

            applied = apply_checked_artifact(artifact_root.parent, repo, 'owner/repo', 42,
                                             pr_sha, run_id, applied_paths, seeds_file)

            destination = data / '专业对照' / '原始PDF' / '专业对照_2027.pdf'
            self.assertEqual(destination.read_bytes(), generated.read_bytes())
            self.assertEqual(applied, ['data/专业对照/原始PDF/专业对照_2027.pdf'])
            self.assertEqual(applied_paths.read_text(encoding='utf-8'),
                             'data/专业对照/原始PDF/专业对照_2027.pdf\n')
            self.assertFalse((artifact_root / 'data/generated/2027/catalog.json').exists())

    def test_manual_artifact_rejects_seed_hash_mismatch_before_copying(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            repo = root / 'repo'
            data = repo / 'data'
            seed = data / 'year-links' / '2027.json'
            seed.parent.mkdir(parents=True)
            seed.write_bytes(b'{"year":2027}\n')
            staging = root / 'staging'
            source = staging / '专业对照' / '原始PDF' / '专业对照_2027.pdf'
            source.parent.mkdir(parents=True)
            source.write_bytes(b'%PDF checked')
            artifact = root / 'artifact' / '2027'
            export_staged_changes(staging, data, artifact, seed, 2027)
            manifest_path = artifact / 'manifest.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            manifest['seedSha256'] = '0' * 64
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            seeds_file = root / 'changed-seeds.txt'
            seeds_file.write_text('data/year-links/2027.json\n', encoding='utf-8')
            package_run_manifest(artifact.parent, 'owner/repo', 42, 'a' * 40, 8123, seeds_file)
            applied_paths = root / 'applied-paths.txt'

            with self.assertRaisesRegex(ValueError, 'seed differs'):
                apply_checked_artifact(artifact.parent, repo, 'owner/repo', 42,
                                       'a' * 40, 8123, applied_paths, seeds_file)

            self.assertFalse((data / '专业对照/原始PDF/专业对照_2027.pdf').exists())


if __name__ == '__main__':
    unittest.main()
