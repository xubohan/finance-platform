#!/usr/bin/env python3
"""Run provider health checks and print JSON."""

from __future__ import annotations

import argparse
import json
import sys

from app.services.provider_health import run_provider_health_check


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fail-on-degraded", action="store_true")
    args = parser.parse_args()

    payload = run_provider_health_check()
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    status = payload["summary"]["status"]
    if status == "error":
        return 1
    if status == "degraded" and args.fail_on_degraded:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
