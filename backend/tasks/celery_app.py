"""Celery application factory for async job execution."""

from __future__ import annotations

import os

from celery import Celery
from celery.schedules import crontab

BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/1")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/2")

celery_app = Celery("fin_terminal", broker=BROKER_URL, backend=RESULT_BACKEND)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    imports=(
        "tasks.data_tasks",
        "tasks.news_tasks",
        "tasks.analysis_tasks",
        "tasks.ohlcv_tasks",
        "tasks.backtest_tasks",
    ),
    beat_schedule={
        "fetch-all-news": {
            "task": "tasks.news_tasks.fetch_all_sources",
            "schedule": crontab(minute="*/15"),
        },
        "process-news-llm": {
            "task": "tasks.news_tasks.process_unanalyzed_news",
            "schedule": crontab(minute="*/30"),
        },
        "sync-cn-daily": {
            "task": "tasks.ohlcv_tasks.sync_cn_watchlist",
            "schedule": crontab(hour="17", minute="0", day_of_week="mon-fri"),
        },
        "sync-northbound": {
            "task": "tasks.ohlcv_tasks.sync_northbound",
            "schedule": crontab(hour="18", minute="0", day_of_week="mon-fri"),
        },
        "calc-event-impact": {
            "task": "tasks.analysis_tasks.calc_pending_event_impact",
            "schedule": crontab(hour="20", minute="0", day_of_week="mon-fri"),
        },
        "cleanup-llm-cache": {
            "task": "tasks.analysis_tasks.cleanup_expired_cache",
            "schedule": crontab(hour="3", minute="0"),
        },
    },
)
