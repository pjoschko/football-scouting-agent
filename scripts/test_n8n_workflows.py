#!/usr/bin/env python3
"""Regression tests for scripts/n8n_workflows.py.

Stdlib-only, run directly: python3 scripts/test_n8n_workflows.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import n8n_workflows as n8n  # noqa: E402


def _make_config(workflow_dir: Path) -> n8n.Config:
    return n8n.Config(
        api_root="https://example.invalid/api/v1",
        api_key="key",
        project_id="project",
        folder_id="folder",
        workflow_dir=workflow_dir,
    )


class DownloadTargetReservationTest(unittest.TestCase):
    def test_duplicate_remote_name_does_not_overwrite_id_matched_download(self) -> None:
        # Two remote workflows share the name "Foo" but have different ids.
        # Only one local file "foo.json" exists locally, tracked under id "A".
        # The second remote workflow ("B") must not resolve to the same
        # already-claimed local path via the name index and overwrite "A".
        with tempfile.TemporaryDirectory() as tmp:
            workflow_dir = Path(tmp)
            local_path = workflow_dir / "foo.json"
            local_path.write_text(
                json.dumps({"id": "A", "name": "Foo", "nodes": [], "connections": {}}),
                encoding="utf-8",
            )

            remote_workflows = [
                {"id": "A", "name": "Foo", "nodes": [{"marker": "A"}], "connections": {}},
                {"id": "B", "name": "Foo", "nodes": [{"marker": "B"}], "connections": {}},
            ]

            config = _make_config(workflow_dir)
            with mock.patch.object(
                n8n, "extract_workflows_from_package", return_value=remote_workflows
            ), mock.patch.object(n8n.N8nClient, "export_folder_package", return_value=b""):
                n8n.download(config, dry_run=False)

            written = {
                path.name: json.loads(path.read_text(encoding="utf-8"))
                for path in workflow_dir.glob("*.json")
            }

            self.assertIn("foo.json", written)
            self.assertEqual(written["foo.json"]["id"], "A")
            self.assertEqual(written["foo.json"]["nodes"], [{"marker": "A"}])

            other_files = {name: data for name, data in written.items() if name != "foo.json"}
            self.assertEqual(len(other_files), 1, f"expected exactly one other file, got {other_files!r}")
            ((_, other_data),) = other_files.items()
            self.assertEqual(other_data["id"], "B")
            self.assertEqual(other_data["nodes"], [{"marker": "B"}])


if __name__ == "__main__":
    unittest.main()
