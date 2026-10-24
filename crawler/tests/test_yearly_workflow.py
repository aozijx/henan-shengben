import re
import unittest
from pathlib import Path


class YearlyWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/yearly-data.yml').read_text(
            encoding='utf-8')

    def test_workflow_is_read_only_and_targets_year_link_changes(self):
        self.assertRegex(self.workflow, r'(?m)^permissions:\s*\n\s+contents:\s*read\s*$')
        self.assertIn("- 'data/year-links/*.json'", self.workflow)

    def test_workflow_runs_check_mode_and_uploads_reports_after_failures(self):
        self.assertRegex(self.workflow, r'python -m convert\.ingest_year --seed .*--check')
        self.assertRegex(self.workflow, r'(?ms)- name: Upload review reports\n\s+if: always\(\).*?actions/upload-artifact@v4')
        self.assertIn('yearly-ingest-reports/', self.workflow)

    def test_pull_request_and_dispatch_feed_the_same_ingest_check_loop(self):
        self.assertIn('$GITHUB_EVENT_NAME" == "pull_request', self.workflow)
        self.assertIn('git diff --name-only', self.workflow)
        self.assertIn('printf \'%s\\n\' "$SEED_PATH" > changed-seeds.txt', self.workflow)
        self.assertEqual(self.workflow.count('python -m convert.ingest_year'), 1)
        self.assertRegex(self.workflow, r'(?s)while IFS= read -r seed; do.*?--seed "\$seed" --check.*?done < changed-seeds\.txt')

    def test_workflow_uses_pinned_runtime_versions_and_does_not_publish(self):
        self.assertRegex(self.workflow, r'python-version:\s*["\']?3\.12')
        self.assertRegex(self.workflow, r'node-version:\s*["\']?22')
        self.assertNotRegex(self.workflow, r'(?im)^\s*(?:git push|git commit|gh pr merge)\b')
        self.assertNotIn('contents: write', self.workflow)


if __name__ == '__main__':
    unittest.main()
