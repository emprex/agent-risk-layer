"""Small Tk-compatible single-flight runner for read-only ARL desktop queries.

Only the main Tk thread calls the scheduler, callbacks or button state setter.
Worker exceptions are never shown to the operator (they could include secrets
or private local file paths). No background task may mutate ARL security state.
"""
from __future__ import annotations

from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable

POLL_MS = 75
FAILURE = {
    "available": False,
    "reason": "The read-only operation could not complete",
}


class ReadOnlyJobs:
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
