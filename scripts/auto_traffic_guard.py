#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Optional one-shot guard for crontab.

The dashboard service already runs this loop every minute.
Only use this script if you want a separate cron process.

  CONFIG_PATH=/path/to/config.json python3 scripts/auto_traffic_guard.py
"""

import os
import sys

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("PYTHONPATH", BACKEND_DIR)

import monitor_service as monitor  # noqa: E402


def main():
    overview = monitor.compute_overview_data()
    monitor.enforce_guards(overview)
    print("guard cycle done")


if __name__ == "__main__":
    main()
