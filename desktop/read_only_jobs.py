"""Single-flight UI job scheduler for ARL's desktop.

Only the Tk main thread touches the scheduler, callbacks and controls. Worker
exceptions are hidden from the UI. This queue does NOT authorise any action:
read-only operations stay read-only, and the one isolated lab preparation
requires independent GUI confirmation and Node.js lab authority guards.
"""
from __future__ import annotations

from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable

POLL_MS = 75
FAILURE = {
    "available": False,
    "reason": "The operator operation could not complete",
}


class OperatorJobs:
    def __init__(
        self,
        schedule: Callable[[int, Callable[[], None]], Any],
        set_busy: Callable[[bool], None],
    ) -> None:
        self._schedule = schedule
        self._set_busy = set_busy
        self._alive = True
        self._busy = False

    @property
    def busy(self) -> bool:
        return self._busy

    def close(self) -> None:
        """Prevent results from reaching a window that is being destroyed."""
        self._alive = False

    def start(
        self,
        work: Callable[[], dict[str, Any]],
        done: Callable[[dict[str, Any]], None],
    ) -> bool:
        """Start at most one worker; never read or write Tk from that worker."""
        if not self._alive or self._busy:
            return False

        results: Queue[dict[str, Any]] = Queue(maxsize=1)
        self._busy = True
        self._set_busy(True)

        def worker() -> None:
            try:
                result = work()
                if not isinstance(result, dict):
                    result = dict(FAILURE)
            except Exception:
                # No exception text: it can contain paths, credentials or
                # customer evidence details from a local subprocess.
                result = dict(FAILURE)
            results.put(result)

        Thread(target=worker, name="arl-readonly-query", daemon=True).start()

        def poll() -> None:
            if not self._alive:
                return
            try:
                result = results.get_nowait()
            except Empty:
                self._schedule(POLL_MS, poll)
                return

            self._busy = False
            self._set_busy(False)
            done(result)

        self._schedule(POLL_MS, poll)
        return True


# Compatibility for the original read-only desktop regression suite.
ReadOnlyJobs = OperatorJobs
