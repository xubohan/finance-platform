"""Common fetcher interface plus circuit breaker state."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass
class CircuitBreakerState:
    """Simple circuit breaker state for upstream provider calls."""

    failures: int = 0
    last_failure: datetime | None = None
    open_until: datetime | None = None
    threshold: int = 3
    recovery_sec: int = 60

    def record_failure(self) -> None:
        self.failures += 1
        self.last_failure = datetime.now(timezone.utc)
        if self.failures >= self.threshold:
            self.open_until = self.last_failure + timedelta(seconds=self.recovery_sec)

    def is_open(self) -> bool:
        if self.open_until is None:
            return False
        if datetime.now(timezone.utc) > self.open_until:
            self.failures = 0
            self.open_until = None
            return False
        return True

    def record_success(self) -> None:
        self.failures = 0
        self.open_until = None


class BaseDataFetcher:
    """Base fetcher with a per-instance circuit breaker."""

    name = "base"

    def __init__(self) -> None:
        self._cb = CircuitBreakerState()

    def _call(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        if self._cb.is_open():
            logger.warning("%s circuit open, skipping provider call", self.name)
            raise RuntimeError(f"{self.name} circuit breaker open")
        try:
            result = func(*args, **kwargs)
            self._cb.record_success()
            return result
        except Exception as exc:
            self._cb.record_failure()
            logger.warning("%s call failed: %s", self.name, exc)
            raise

    def fetch_ohlcv(self, symbol: str, start: str, end: str, interval: str) -> Any:
        raise NotImplementedError

    def fetch_quote(self, symbol: str) -> dict[str, Any]:
        raise NotImplementedError

    def fetch_fundamentals(self, symbol: str, report_type: str = "income") -> Any:
        raise NotImplementedError
