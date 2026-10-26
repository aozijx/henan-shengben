import re
import unittest
from pathlib import Path


class YearlyWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/yearly-data.yml').read_text(
            encoding='utf-8')

    def test_pull_request_detects_changed_seeds_and_exports_checked_artifact(self):
        self.assertIn("types: [opened, synchronize, reopened, closed]", self.workflow)
        self.assertIn('git diff --name-only', self.workflow)
        self.assertIn('yearly-ingest-pr-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}', self.workflow)
        self.assertIn('yearly-ingest-manual-${{ github.sha }}', self.workflow)
        self.assertIn('python -m convert.ingest_artifact package', self.workflow)

    def test_validation_runs_isolated_check_with_edge_and_preserves_failure_reports(self):
        self.assertRegex(self.workflow, r'(?m)^\s+runs-on:\s*ubuntu-24\.04\s*$')
        self.assertRegex(self.workflow, r'(?ms)^\s+WAF_BROWSER_PATH:\s*/usr/bin/microsoft-edge\s*$.*?WAF_HEADLESS:\s*[\'"]?false')
        self.assertIn('Ensure Xvfb is available for headed Edge', self.workflow)
        self.assertRegex(self.workflow, r'python -m convert\.ingest_year --seed .*--check')
        self.assertIn('--export-dir "yearly-ingest-output/${name}"', self.workflow)
        self.assertRegex(self.workflow, r"(?ms)- name: Upload review reports\n\s+if: always\(\).*?actions/upload-artifact@v4")
        self.assertIn('yearly-ingest-reports/', self.workflow)

    def test_only_trusted_publisher_jobs_can_write_to_main(self):
        validate, publishers = self.workflow.split('  publish:', 1)
        self.assertIn('contents: read', validate)
        self.assertNotIn('contents: write', validate)
        self.assertIn('contents: write', publishers)
        self.assertIn('python -m convert.ingest_artifact apply', publishers)
        self.assertIn('git push origin HEAD:main', publishers)
        self.assertIn('git push origin "HEAD:${BASE_REF}"', publishers)

    def test_partial_artifact_does_not_refresh_catalog(self):
        self.assertIn('completeYears', self.workflow)
        self.assertIn("steps.catalog.outputs.complete == 'true'", self.workflow)


if __name__ == '__main__':
    unittest.main()
