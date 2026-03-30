#!/usr/bin/env python3
"""Live-only audit gate for runtime-facing source code.

This audit focuses on detecting patterns that can masquerade non-live data as
realtime/live data in production paths.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


DEFAULT_SCOPES = (
    "backend/app",
    "backend/tasks",
    "scripts",
    "frontend/src/api",
    "frontend/src/pages",
    "frontend/src/components",
    "frontend/scripts",
    "docs/visual-regression/README.md",
)

EXCLUDED_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "logs",
    "node_modules",
    "venv",
}

EXCLUDED_FILE_PATTERNS = (
    re.compile(r"(^|/)(tests?/|test_|.*\.test\.(ts|tsx|js|jsx|py)$|.*_test\.py$)", re.IGNORECASE),
    re.compile(r"(^|/)frontend/performance-budget\.json$", re.IGNORECASE),
    re.compile(r"(^|/)docs/visual-regression/market_workspace_baseline\.json$", re.IGNORECASE),
)

INCLUDED_SUFFIXES = {".py", ".sh", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml"}


@dataclass(frozen=True)
class Rule:
    code: str
    description: str
    pattern: re.Pattern[str]


@dataclass(frozen=True)
class Finding:
    rule: str
    description: str
    path: str
    line: int
    snippet: str


RULES: tuple[Rule, ...] = (
    Rule(
        code="LIVE001",
        description="禁止使用 database_partial（会把数据库局部数据伪装成可用实时链路）",
        pattern=re.compile(r"\bdatabase_partial\b", re.IGNORECASE),
    ),
    Rule(
        code="LIVE002",
        description="禁止 runtime 数据链路里出现 mock/fake/fixture/demo/intercept 伪实时标识",
        pattern=re.compile(
            r"\b(?:mock|fake|fixture|demo|intercept)(?:_|-)?"
            r"(?:quote|kline|ohlcv|price|realtime|live|feed|provider|data)\b",
            re.IGNORECASE,
        ),
    ),
    Rule(
        code="LIVE002B",
        description="禁止使用 mock-backed 截图、buildFixtures 或浏览器路由拦截伪造运行态",
        pattern=re.compile(r"mock-backed|buildFixtures\s*\(|page\.route\s*\(|route\.fulfill\s*\(", re.IGNORECASE),
    ),
    Rule(
        code="LIVE003",
        description="禁止启用 USE/ENABLE/ALLOW_*MOCK|FAKE|FIXTURE|DEMO|INTERCEPT 开关",
        pattern=re.compile(r"\b(?:use|enable|allow)_(?:mock|fake|fixture|demo|intercept)\b", re.IGNORECASE),
    ),
    Rule(
        code="LIVE004",
        description='禁止 source/fetch_source/provider/data_source 字段直接标注为 "mock|fake|fixture|demo|intercept"',
        pattern=re.compile(
            r"['\"](?:source|fetch_source|provider|data_source)['\"]\s*:\s*['\"]"
            r"(?:mock|fake|fixture|demo|intercept)\b",
            re.IGNORECASE,
        ),
    ),
    Rule(
        code="LIVE004B",
        description='禁止 source/fetch_source/provider/data_source 字段直接标注为 "local|database_partial"',
        pattern=re.compile(
            r"['\"](?:source|fetch_source|provider|data_source|storage_source|ohlcv_source)['\"]\s*:\s*['\"]"
            r"(?:local|database_partial)\b",
            re.IGNORECASE,
        ),
    ),
)

SOURCE_LIVE_RE = re.compile(r"['\"]source['\"]\s*:\s*['\"]live['\"]", re.IGNORECASE)
LOCAL_ALIAS_RE = re.compile(r"\b(?:local|database_partial|mock|fake|fixture|demo|intercept)\b", re.IGNORECASE)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit code for live-only data guarantees.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--scope",
        action="append",
        default=[],
        help="Override default scopes. Can be provided multiple times.",
    )
    parser.add_argument("--json", action="store_true", help="Output findings as JSON.")
    parser.add_argument("--max-findings", type=int, default=200, help="Max findings to print.")
    parser.add_argument("--non-strict", action="store_true", help="Always return exit code 0.")
    return parser.parse_args()


def should_skip_path(rel_path: str) -> bool:
    for pattern in EXCLUDED_FILE_PATTERNS:
        if pattern.search(rel_path):
            return True
    # Avoid self-matching audit scripts.
    if rel_path in {"scripts/audit_live_only.py", "scripts/audit_live_only.sh"}:
        return True
    return False


def iter_scope_files(root: Path, scopes: Iterable[str]) -> Iterable[Path]:
    for scope in scopes:
        scope_path = (root / scope).resolve()
        if not scope_path.exists():
            continue
        if scope_path.is_file():
            yield scope_path
            continue
        for path in scope_path.rglob("*"):
            if not path.is_file():
                continue
            rel_parts = path.relative_to(root).parts
            if any(part in EXCLUDED_DIRS for part in rel_parts):
                continue
            if path.suffix.lower() not in INCLUDED_SUFFIXES:
                continue
            rel_path = path.relative_to(root).as_posix()
            if should_skip_path(rel_path):
                continue
            yield path


def read_text(path: Path) -> str | None:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
    if "\x00" in content:
        return None
    return content


def collect_findings(root: Path, files: Iterable[Path]) -> tuple[list[Finding], int]:
    findings: list[Finding] = []
    scanned = 0
    for file_path in files:
        content = read_text(file_path)
        if content is None:
            continue
        scanned += 1
        lines = content.splitlines()
        rel_path = file_path.relative_to(root).as_posix()

        for index, line in enumerate(lines, start=1):
            for rule in RULES:
                if rule.pattern.search(line):
                    findings.append(
                        Finding(
                            rule=rule.code,
                            description=rule.description,
                            path=rel_path,
                            line=index,
                            snippet=line.strip(),
                        )
                    )

        # LIVE005: detect mixed source=live with nearby local/mock markers.
        for index, line in enumerate(lines, start=1):
            if not SOURCE_LIVE_RE.search(line):
                continue
            start = max(0, index - 4)
            end = min(len(lines), index + 3)
            nearby = "\n".join(lines[start:end])
            if not LOCAL_ALIAS_RE.search(nearby):
                continue
            findings.append(
                Finding(
                    rule="LIVE005",
                    description="检测到 source=live 与 local/mock/fake/database_partial 邻近出现，疑似伪实时拼接",
                    path=rel_path,
                    line=index,
                    snippet=line.strip(),
                )
            )

    return findings, scanned


def print_text_report(root: Path, scopes: Iterable[str], findings: list[Finding], scanned_files: int, max_findings: int) -> None:
    print("=== Live-Only Audit ===")
    print(f"root: {root}")
    print(f"scopes: {', '.join(scopes)}")
    print(f"scanned_files: {scanned_files}")
    if not findings:
        print("status: PASS")
        print("details: no live-only violations detected")
        return

    print("status: FAIL")
    print(f"violations: {len(findings)}")
    for item in findings[:max_findings]:
        print(f"- {item.rule} {item.path}:{item.line} {item.description}")
        print(f"  snippet: {item.snippet}")
    if len(findings) > max_findings:
        print(f"... truncated {len(findings) - max_findings} additional findings")

    by_rule: dict[str, int] = {}
    for item in findings:
        by_rule[item.rule] = by_rule.get(item.rule, 0) + 1
    summary = ", ".join(f"{rule}={count}" for rule, count in sorted(by_rule.items()))
    print(f"rule_summary: {summary}")
    print("docker_hint: run this gate before smoke scripts in Docker-first validation")


def print_json_report(root: Path, scopes: Iterable[str], findings: list[Finding], scanned_files: int) -> None:
    payload = {
        "root": str(root),
        "scopes": list(scopes),
        "scanned_files": scanned_files,
        "status": "PASS" if not findings else "FAIL",
        "violations": [
            {
                "rule": finding.rule,
                "description": finding.description,
                "path": finding.path,
                "line": finding.line,
                "snippet": finding.snippet,
            }
            for finding in findings
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    scopes = tuple(args.scope) if args.scope else DEFAULT_SCOPES
    files = list(iter_scope_files(root, scopes))
    findings, scanned_files = collect_findings(root, files)

    if args.json:
        print_json_report(root, scopes, findings, scanned_files)
    else:
        print_text_report(root, scopes, findings, scanned_files, args.max_findings)

    if args.non_strict:
        return 0
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
