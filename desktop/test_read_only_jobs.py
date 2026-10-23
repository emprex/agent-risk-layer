"""Headless tests for the Tk main-thread single-flight read-only scheduler."""
from __future__ import annotations

import threading
import time
import unittest

from desktop.read_only_jobs import ReadOnlyJobs


class SimulatedTk:
    """No Tk interpreter or desktop display required."""
    def __init__(self) -> None:
        self.callbacks = []
        self.main_thread = threading.get_ident()
        self.busy_calls = []

    def after(self, ms, callback) -> None:
        assert threading.get_ident() == self.main_thread
        assert ms > 0
        self.callbacks.append(callback)

    def set_busy(self, value) -> None:
        assert threading.get_ident() == self.main_thread
        self.busy_calls.append(value)

    def tick(self) -> None:
        if self.callbacks:
            callback = self.callbacks.pop(0)
            callback()

    def drain(self, until, max_seconds=2) -> None:
        deadline = time.monotonic() + max_seconds
        while not until() and time.monotonic() < deadline:
            self.tick()
            time.sleep(0.002)
        if not until():
            raise AssertionError("Read-only job did not finish")


class ReadOnlyJobsTests(unittest.TestCase):
    def test_worker_never_calls_gui_and_returns_on_main_thread(self):
        gui = SimulatedTk()
        jobs = ReadOnlyJobs(gui.after, gui.set_busy)
        worker_threads = []
        received = []
        def work():
            worker_threads.append(threading.get_ident())
            return {"available": True, "reason": None}
        def show(result):
            self.assertEqual(threading.get_ident(), gui.main_thread)
            received.append(result)
        self.assertTrue(jobs.start(work, show))
        self.assertTrue(jobs.busy)
        self.assertEqual(gui.busy_calls, [True])
        gui.drain(lambda: len(received) == 1)
        self.assertNotEqual(worker_threads[0], gui.main_thread)
        self.assertEqual(received, [{"available": True, "reason": None}])
        self.assertEqual(gui.busy_calls, [True, False])
        self.assertFalse(jobs.busy)

    def test_second_job_is_rejected_until_first_finishes(self):
        gui = SimulatedTk()
        jobs = ReadOnlyJobs(gui.after, gui.set_busy)
        released = threading.Event()
        started = threading.Event()
        received = []
        def blocked():
            started.set()
            released.wait(1)
            return {"available": True}
        self.assertTrue(jobs.start(blocked, received.append))
        self.assertTrue(started.wait(1))
        self.assertFalse(jobs.start(
            lambda: {"available": True, "should_not_run": True}, received.append
        ))
        released.set()
        gui.drain(lambda: len(received) == 1)
        self.assertNotIn("should_not_run", str(received))
        self.assertTrue(jobs.start(lambda: {"available": False}, received.append))
        gui.drain(lambda: len(received) == 2)
        self.assertFalse(received[-1]["available"])

    def test_private_exception_is_sanitised_not_logged_in_gui(self):
        gui = SimulatedTk()
        jobs = ReadOnlyJobs(gui.after, gui.set_busy)
        out = []
        def failure():
            raise RuntimeError("PRIVATE_CUSTOMER_SECRET must not be shown")
        self.assertTrue(jobs.start(failure, out.append))
        gui.drain(lambda: len(out) == 1)
        self.assertFalse(out[0]["available"])
        self.assertNotIn("PRIVATE_CUSTOMER_SECRET", str(out))

    def test_closed_window_drops_late_worker_result(self):
        gui = SimulatedTk()
        jobs = ReadOnlyJobs(gui.after, gui.set_busy)
        started = threading.Event()
        released = threading.Event()
        displayed = []
        def work():
            started.set()
            released.wait(1)
            return {"available": True}
        self.assertTrue(jobs.start(work, displayed.append))
        self.assertTrue(started.wait(1))
        jobs.close()
        released.set()
        for _ in range(5):
            gui.tick()
        self.assertEqual(displayed, [])
        self.assertFalse(jobs.start(lambda: {"available": True}, displayed.append))

    def test_unstructured_worker_result_fails_closed(self):
        gui = SimulatedTk()
        jobs = ReadOnlyJobs(gui.after, gui.set_busy)
        displayed = []
        self.assertTrue(jobs.start(lambda: "SENSITIVE_RAW_STRING", displayed.append))
        gui.drain(lambda: bool(displayed))
        self.assertFalse(displayed[0]["available"])
        self.assertNotIn("SENSITIVE_RAW_STRING", str(displayed))


if __name__ == "__main__":
    unittest.main()
