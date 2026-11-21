#!/usr/bin/env python3
"""Start only the fixed local security-test dispatcher in its own process group.

This exists to make Cancel/Close/timeout terminate child test processes as well.
No shell or operator-selected executable path is permitted.
"""
import os
from pathlib import Path
import sys


def main():
    expected = Path(__file__).resolve().parent / 'enkyron-security-tests-cli.mjs'
    if (len(sys.argv) < 4 or Path(sys.argv[1]).resolve() != expected or
            sys.argv[2] not in {'list', 'run', 'record'}):
        raise SystemExit(2)
    # Child process PID becomes process-group ID, so the Qt owner can killpg.
    os.setsid()
    os.execvp('node', ['node', str(expected), *sys.argv[2:]])


if __name__ == '__main__':
    main()
