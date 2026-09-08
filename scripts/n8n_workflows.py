#!/usr/bin/env python3
"""Synchronize n8n workflows between this repository and one n8n folder.

Commands:
  publish   Publish every workflow in the configured remote n8n folder,
            dependency-first.
  download  Download every workflow from the configured remote n8n folder
            into the local workflow directory.
  upload    Upload every local workflow, replacing matching remote workflows
            and creating missing ones in the configured n8n folder.

Configuration can be passed as CLI options or environment variables:
  N8N_URL          e.g. https://n8n.example.com or https://n8n.example.com/api/v1
  N8N_API_KEY      n8n public API key
  N8N_PROJECT_ID   target n8n project ID
  N8N_FOLDER_ID    target n8n folder ID
  N8N_WORKFLOW_DIR local directory, defaults to ./n8n

The script intentionally uses only Python's standard library.
"""

from __future__ import annotations

import argparse
import copy
import io
import json
import os
import re
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TIMEOUT_SECONDS = 60
WORKFLOW_NODE_TYPE = "n8n-nodes-base.executeWorkflow"


class SyncError(RuntimeError):
    """Raised for a user-actionable synchronization error."""


@dataclass(frozen=True)
class Config:
    api_root: str
    api_key: str
    project_id: str
    folder_id: str
    workflow_dir: Path
    timeout: int = DEFAULT_TIMEOUT_SECONDS


@dataclass
class LocalWorkflow:
    path: Path
    data: dict[str, Any]

    @property
    def id(self) -> str | None:
        value = self.data.get("id")
        return value if isinstance(value, str) and value else None

    @property
    def name(self) -> str:
        value = self.data.get("name")
        if not isinstance(value, str) or not value.strip():
            raise SyncError(f"{self.path}: workflow has no valid name")
        return value.strip()


class N8nClient:
    def __init__(self, config: Config):
        self.config = config

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Any | None = None,
        accept: str = "application/json",
        raw: bool = False,
    ) -> Any:
        url = f"{self.config.api_root}{path}"
        data = None
        headers = {
            "X-N8N-API-KEY": self.config.api_key,
            "Accept": accept,
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                payload = response.read()
                if raw:
                    return payload
                if not payload:
                    return None
                return json.loads(payload.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            response_body = exc.read().decode("utf-8", errors="replace")
            detail = response_body.strip() or exc.reason
            raise SyncError(f"n8n API {method} {path} failed with HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise SyncError(f"Cannot reach n8n API at {url}: {exc.reason}") from exc

    def export_folder_package(self) -> bytes:
        # The folder export is the public-API-supported way to enumerate exactly
        # the workflows in a folder (including nested folders). reference-only
        # keeps static dependencies outside the selected folder out of the result.
        body = {
            "folderIds": [self.config.folder_id],
            "includeVariableValues": False,
            "includeTags": False,
            "missingWorkflowDependencyPolicy": "reference-only",
        }
        try:
            return self._request(
                "POST",
                "/n8n-packages/export",
                body=body,
                accept="application/gzip",
                raw=True,
            )
        except SyncError as exc:
            raise SyncError(
                f"Could not export n8n folder {self.config.folder_id}. "
                "The API key needs workflow:export and access to the folder; "
                "on n8n versions/licences where folder package export is unavailable, "
                f"publish/download cannot enumerate a folder safely. Original error: {exc}"
            ) from exc

    def publish_workflow(self, workflow_id: str) -> dict[str, Any]:
        response = self._request("POST", f"/workflows/{urllib.parse.quote(workflow_id)}/publish", body={})
        if not isinstance(response, dict):
            raise SyncError(f"Unexpected publish response for workflow {workflow_id}")
        return response

    def update_workflow(self, workflow_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        # Keep upload and publish separate operations. If the workflow is already
        # published, publishIfActive=false stores this update as a draft instead of
        # immediately republishing it.
        response = self._request(
            "PUT",
            f"/workflows/{urllib.parse.quote(workflow_id)}?publishIfActive=false",
            body=payload,
        )
        if not isinstance(response, dict):
            raise SyncError(f"Unexpected update response for workflow {workflow_id}")
        return response

    def create_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = self._request("POST", "/workflows", body=payload)
        if not isinstance(response, dict):
            raise SyncError("Unexpected create workflow response")
        return response


def normalize_api_root(url: str) -> str:
    value = url.strip().rstrip("/")
    if not value:
        raise SyncError("N8N_URL/--url is required")
    if value.endswith("/api/v1"):
        return value
    return f"{value}/api/v1"


def is_workflow(data: Any) -> bool:
    return (
        isinstance(data, dict)
        and isinstance(data.get("name"), str)
        and isinstance(data.get("nodes"), list)
        and isinstance(data.get("connections"), dict)
    )


def load_local_workflows(directory: Path) -> list[LocalWorkflow]:
    if not directory.exists():
        raise SyncError(f"Workflow directory does not exist: {directory}")
    if not directory.is_dir():
        raise SyncError(f"Workflow path is not a directory: {directory}")

    workflows: list[LocalWorkflow] = []
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SyncError(f"Invalid JSON in {path}: {exc}") from exc
        if is_workflow(data):
            workflows.append(LocalWorkflow(path=path, data=data))

    if not workflows:
        raise SyncError(f"No workflow JSON files found in {directory}")
    _assert_unique_local_identity(workflows)
    return workflows


def _assert_unique_local_identity(workflows: Iterable[LocalWorkflow]) -> None:
    by_id: dict[str, Path] = {}
    by_name: dict[str, Path] = {}
    for workflow in workflows:
        if workflow.id:
            if workflow.id in by_id:
                raise SyncError(
                    f"Duplicate local workflow id {workflow.id}: {by_id[workflow.id]} and {workflow.path}"
                )
            by_id[workflow.id] = workflow.path
        if workflow.name in by_name:
            raise SyncError(
                f"Duplicate local workflow name {workflow.name!r}: {by_name[workflow.name]} and {workflow.path}"
            )
        by_name[workflow.name] = workflow.path


def static_subworkflow_ids(workflow: dict[str, Any]) -> set[str]:
    dependencies: set[str] = set()
    for node in workflow.get("nodes", []):
        if not isinstance(node, dict) or node.get("type") != WORKFLOW_NODE_TYPE:
            continue
        parameters = node.get("parameters")
        if not isinstance(parameters, dict):
            continue
        workflow_id = parameters.get("workflowId")
        if isinstance(workflow_id, dict):
            workflow_id = workflow_id.get("value")
        if isinstance(workflow_id, str):
            value = workflow_id.strip()
            if value and not value.startswith("=") and "{{" not in value:
                dependencies.add(value)
    return dependencies


def dependency_order(workflows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    items = list(workflows)
    by_id = {
        wf["id"]: wf
        for wf in items
        if isinstance(wf.get("id"), str) and wf.get("id")
    }
    key_for_object: dict[int, str] = {}
    for index, workflow in enumerate(items):
        workflow_id = workflow.get("id")
        key = workflow_id if isinstance(workflow_id, str) and workflow_id else f"__anonymous_{index}"
        key_for_object[id(workflow)] = key

    deps: dict[str, set[str]] = {}
    item_by_key: dict[str, dict[str, Any]] = {}
    for workflow in items:
        key = key_for_object[id(workflow)]
        item_by_key[key] = workflow
        deps[key] = {dep for dep in static_subworkflow_ids(workflow) if dep in by_id and dep != key}

    ordered: list[dict[str, Any]] = []
    remaining = set(item_by_key)
    while remaining:
        ready = [key for key in remaining if not (deps[key] & remaining)]
        if not ready:
            cycle = ", ".join(sorted(_workflow_label(item_by_key[key]) for key in remaining))
            raise SyncError(f"Static sub-workflow dependency cycle detected: {cycle}")
        ready.sort(key=lambda key: (_workflow_label(item_by_key[key]).casefold(), key))
        for key in ready:
            ordered.append(item_by_key[key])
            remaining.remove(key)
    return ordered


def _workflow_label(workflow: dict[str, Any]) -> str:
    name = workflow.get("name")
    workflow_id = workflow.get("id")
    if isinstance(name, str) and name:
        return name
    if isinstance(workflow_id, str) and workflow_id:
        return workflow_id
    return "<unnamed workflow>"


def extract_workflows_from_package(package_bytes: bytes) -> list[dict[str, Any]]:
    workflows: list[dict[str, Any]] = []
    try:
        with tarfile.open(fileobj=io.BytesIO(package_bytes), mode="r:gz") as archive:
            for member in archive.getmembers():
                normalized = member.name.replace("\\", "/")
                if not member.isfile() or not normalized.endswith("/workflow.json"):
                    continue
                if "/workflows/" not in f"/{normalized}":
                    continue
                extracted = archive.extractfile(member)
                if extracted is None:
                    continue
                data = json.loads(extracted.read().decode("utf-8"))
                if is_workflow(data):
                    workflows.append(data)
    except (tarfile.TarError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SyncError(f"Cannot read n8n folder export package: {exc}") from exc

    return workflows


def sanitize_write_payload(workflow: dict[str, Any]) -> dict[str, Any]:
    # n8n's public API rejects unknown/read-only fields. Keep only fields that
    # are writable in the workflow create/update schemas.
    required = ("name", "nodes", "connections", "settings")
    missing = [key for key in required if key not in workflow]
    if missing:
        raise SyncError(f"Workflow {_workflow_label(workflow)} is missing required fields: {', '.join(missing)}")

    allowed = (
        "name",
        "description",
        "nodes",
        "connections",
        "nodeGroups",
        "settings",
        "staticData",
        "pinData",
    )
    payload = {key: copy.deepcopy(workflow[key]) for key in allowed if key in workflow}
    payload.setdefault("settings", {})
    return payload


def rewrite_subworkflow_ids(workflow: dict[str, Any], id_mapping: dict[str, str]) -> dict[str, Any]:
    rewritten = copy.deepcopy(workflow)
    for node in rewritten.get("nodes", []):
        if not isinstance(node, dict) or node.get("type") != WORKFLOW_NODE_TYPE:
            continue
        parameters = node.get("parameters")
        if not isinstance(parameters, dict):
            continue
        workflow_id = parameters.get("workflowId")
        if isinstance(workflow_id, dict):
            value = workflow_id.get("value")
            if isinstance(value, str) and value in id_mapping:
                workflow_id["value"] = id_mapping[value]
        elif isinstance(workflow_id, str) and workflow_id in id_mapping:
            parameters["workflowId"] = id_mapping[workflow_id]
    return rewritten


def _remote_indexes(workflows: Iterable[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    by_id: dict[str, dict[str, Any]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    for workflow in workflows:
        workflow_id = workflow.get("id")
        name = workflow.get("name")
        if isinstance(workflow_id, str) and workflow_id:
            by_id[workflow_id] = workflow
        if isinstance(name, str) and name:
            by_name.setdefault(name, []).append(workflow)
    return by_id, by_name


def _match_remote(
    local: LocalWorkflow,
    remote_by_id: dict[str, dict[str, Any]],
    remote_by_name: dict[str, list[dict[str, Any]]],
) -> dict[str, Any] | None:
    if local.id and local.id in remote_by_id:
        return remote_by_id[local.id]
    matches = remote_by_name.get(local.name, [])
    if len(matches) > 1:
        ids = ", ".join(str(item.get("id")) for item in matches)
        raise SyncError(
            f"Cannot safely match local workflow {local.name!r}: multiple remote workflows "
            f"in folder {ids}. Match by stable workflow id or remove the duplicate names."
        )
    return matches[0] if matches else None


def upload(config: Config, *, dry_run: bool) -> None:
    local = load_local_workflows(config.workflow_dir)
    client = N8nClient(config)
    # Scope replace/name matching to the configured target folder (the same
    # folder export publish/download use) so a same-named or same-id workflow
    # living in a different folder can never be overwritten or moved here.
    remote = extract_workflows_from_package(client.export_folder_package())
    remote_by_id, remote_by_name = _remote_indexes(remote)

    local_by_id = {wf.id: wf for wf in local if wf.id}
    ordered_data = dependency_order([wf.data for wf in local])
    local_by_object = {id(wf.data): wf for wf in local}

    # Establish all mappings we can before the first write. This also lets a
    # parent workflow be rewritten to a remote child ID even when both already exist.
    id_mapping: dict[str, str] = {}
    matches: dict[Path, dict[str, Any] | None] = {}
    for workflow in local:
        match = _match_remote(workflow, remote_by_id, remote_by_name)
        matches[workflow.path] = match
        if workflow.id and match and isinstance(match.get("id"), str):
            id_mapping[workflow.id] = match["id"]

    print("Upload order (dependencies first):")
    for index, data in enumerate(ordered_data, start=1):
        print(f"  {index:02d}. {_workflow_label(data)}")

    for data in ordered_data:
        local_workflow = local_by_object[id(data)]
        unresolved = [
            dep
            for dep in static_subworkflow_ids(data)
            if dep in local_by_id and dep not in id_mapping
        ]
        if unresolved:
            raise SyncError(
                f"Cannot upload {local_workflow.name}: local dependencies have no remote ID yet: "
                + ", ".join(sorted(unresolved))
            )

        rewritten = rewrite_subworkflow_ids(data, id_mapping)
        payload = sanitize_write_payload(rewritten)
        payload["parentFolderId"] = config.folder_id
        match = matches[local_workflow.path]

        if match:
            remote_id = match.get("id")
            if not isinstance(remote_id, str) or not remote_id:
                raise SyncError(f"Remote workflow match for {local_workflow.name} has no id")
            print(f"UPDATE  {local_workflow.name} -> {remote_id}")
            if dry_run:
                continue
            response = client.update_workflow(remote_id, payload)
        else:
            create_payload = dict(payload)
            create_payload["projectId"] = config.project_id
            print(f"CREATE  {local_workflow.name}")
            if dry_run:
                # A future remote ID cannot be known without creating the workflow.
                # Dry-run therefore stops if another local workflow depends on it.
                if local_workflow.id and any(
                    local_workflow.id in static_subworkflow_ids(other.data) for other in local
                ):
                    raise SyncError(
                        f"Dry-run cannot continue past missing dependency {local_workflow.name!r}: "
                        "n8n assigns its remote ID only when it is created. Run upload without --dry-run."
                    )
                continue
            response = client.create_workflow(create_payload)
            matches[local_workflow.path] = response

        response_id = response.get("id")
        if not isinstance(response_id, str) or not response_id:
            raise SyncError(f"n8n returned no workflow id for {local_workflow.name}")
        if local_workflow.id:
            id_mapping[local_workflow.id] = response_id
        remote_by_id[response_id] = response
        remote_by_name.setdefault(local_workflow.name, []).append(response)

    if dry_run:
        print("Dry-run complete; no workflows were changed.")
    else:
        print(f"Uploaded {len(local)} workflow(s) into n8n folder {config.folder_id}.")


def _slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9äöüß]+", "-", value, flags=re.IGNORECASE)
    value = value.strip("-")
    return value or "workflow"


def _existing_local_filename_map(directory: Path) -> tuple[dict[str, Path], dict[str, list[Path]]]:
    by_id: dict[str, Path] = {}
    by_name: dict[str, list[Path]] = {}
    if not directory.exists():
        return by_id, by_name
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not is_workflow(data):
            continue
        workflow_id = data.get("id")
        name = data.get("name")
        if isinstance(workflow_id, str) and workflow_id:
            by_id[workflow_id] = path
        if isinstance(name, str) and name:
            by_name.setdefault(name, []).append(path)
    return by_id, by_name


def download(config: Config, *, dry_run: bool) -> None:
    client = N8nClient(config)
    workflows = extract_workflows_from_package(client.export_folder_package())
    if not workflows:
        raise SyncError(f"n8n folder {config.folder_id} contains no workflows")
    config.workflow_dir.mkdir(parents=True, exist_ok=True)
    existing_by_id, existing_by_name = _existing_local_filename_map(config.workflow_dir)
    reserved: set[Path] = set()

    for workflow in sorted(workflows, key=lambda wf: _workflow_label(wf).casefold()):
        workflow_id = workflow.get("id")
        name = _workflow_label(workflow)
        target: Path | None = None
        if isinstance(workflow_id, str) and workflow_id in existing_by_id:
            target = existing_by_id[workflow_id]
        else:
            name_matches = existing_by_name.get(name, [])
            if len(name_matches) == 1:
                target = name_matches[0]
            elif len(name_matches) > 1:
                raise SyncError(f"Multiple local files have workflow name {name!r}; cannot choose download target")

        if target is None:
            base = _slugify(name)
            target = config.workflow_dir / f"{base}.json"
            suffix = 2
            while target in reserved or (target.exists() and target not in existing_by_id.values()):
                target = config.workflow_dir / f"{base}-{suffix}.json"
                suffix += 1

        reserved.add(target)
        action = "OVERWRITE" if target.exists() else "CREATE"
        print(f"{action:9s} {name} -> {target}")
        if not dry_run:
            target.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if dry_run:
        print("Dry-run complete; no local files were changed.")
    else:
        print(f"Downloaded {len(workflows)} workflow(s) from n8n folder {config.folder_id}.")


def publish(config: Config, *, dry_run: bool) -> None:
    client = N8nClient(config)
    workflows = extract_workflows_from_package(client.export_folder_package())
    if not workflows:
        raise SyncError(f"n8n folder {config.folder_id} contains no workflows")
    ordered = dependency_order(workflows)

    print("Publish order (dependencies first):")
    for index, workflow in enumerate(ordered, start=1):
        workflow_id = workflow.get("id")
        if not isinstance(workflow_id, str) or not workflow_id:
            raise SyncError(f"Remote workflow {_workflow_label(workflow)} has no id")
        print(f"  {index:02d}. {_workflow_label(workflow)} ({workflow_id})")

    if dry_run:
        print("Dry-run complete; no workflow was published.")
        return

    for workflow in ordered:
        workflow_id = workflow["id"]
        print(f"PUBLISH {_workflow_label(workflow)} ({workflow_id})")
        client.publish_workflow(workflow_id)
    print(f"Published {len(ordered)} workflow(s) from n8n folder {config.folder_id}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Synchronize repository n8n workflow JSON files with one n8n folder."
    )
    parser.add_argument("command", choices=("publish", "download", "upload"))
    parser.add_argument("--url", default=os.getenv("N8N_URL"), help="n8n instance URL; env: N8N_URL")
    parser.add_argument(
        "--api-key",
        default=os.getenv("N8N_API_KEY"),
        help="n8n public API key; env: N8N_API_KEY",
    )
    parser.add_argument(
        "--project-id",
        default=os.getenv("N8N_PROJECT_ID"),
        help="n8n project ID; env: N8N_PROJECT_ID",
    )
    parser.add_argument(
        "--folder-id",
        default=os.getenv("N8N_FOLDER_ID"),
        help="n8n folder ID; env: N8N_FOLDER_ID",
    )
    parser.add_argument(
        "--dir",
        dest="workflow_dir",
        default=os.getenv("N8N_WORKFLOW_DIR", "n8n"),
        help="local workflow directory; env: N8N_WORKFLOW_DIR; default: n8n",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=int(os.getenv("N8N_TIMEOUT", str(DEFAULT_TIMEOUT_SECONDS))),
        help=f"HTTP timeout in seconds; default: {DEFAULT_TIMEOUT_SECONDS}",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show intended actions without changing n8n/local workflow files",
    )
    return parser


def config_from_args(args: argparse.Namespace) -> Config:
    missing = [
        label
        for label, value in (
            ("N8N_URL/--url", args.url),
            ("N8N_API_KEY/--api-key", args.api_key),
            ("N8N_PROJECT_ID/--project-id", args.project_id),
            ("N8N_FOLDER_ID/--folder-id", args.folder_id),
        )
        if not value
    ]
    if missing:
        raise SyncError("Missing configuration: " + ", ".join(missing))
    if args.timeout <= 0:
        raise SyncError("--timeout must be greater than zero")
    return Config(
        api_root=normalize_api_root(args.url),
        api_key=args.api_key,
        project_id=args.project_id,
        folder_id=args.folder_id,
        workflow_dir=Path(args.workflow_dir),
        timeout=args.timeout,
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        config = config_from_args(args)
        if args.command == "publish":
            publish(config, dry_run=args.dry_run)
        elif args.command == "download":
            download(config, dry_run=args.dry_run)
        else:
            upload(config, dry_run=args.dry_run)
        return 0
    except SyncError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
