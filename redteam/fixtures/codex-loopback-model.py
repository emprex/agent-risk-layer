#!/usr/bin/python3
"""Synthetic Responses API fixture for a network-isolated Codex protocol smoke.

Local namespace only. Fixed response, no credentials, no generated actions.
Never use this as a security test or real model substitute.
"""
import http.server
import json
import pathlib
import sys

PORT = 18787
ROOT = pathlib.Path("/scratch")
SENTINEL = "ARL_LOCAL_FIXTURE_OK"
MAX_BODY = 65536


class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, _fmt, *_args):
        return

    def do_POST(self):
        if self.path != "/v1/responses":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if not 0 < length <= MAX_BODY:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, ValueError):
            self.send_error(400)
            return
        if not isinstance(payload, dict) or payload.get("stream") is not True:
            self.send_error(422)
            return
        # This local marker only proves a syntactically valid, bounded POST.
        (ROOT / "fixture-contact").write_text("1", encoding="utf-8")
        events = [
            {"type": "response.created", "response": {"id": "resp-arl-fixture"}},
            {
                "type": "response.output_item.done",
                "item": {
                    "type": "message",
                    "role": "assistant",
                    "id": "msg-arl-fixture",
                    "content": [{"type": "output_text", "text": SENTINEL}],
                },
            },
            {
                "type": "response.completed",
                "response": {
                    "id": "resp-arl-fixture",
                    "usage": {
                        "input_tokens": 4,
                        "input_tokens_details": {"cached_tokens": 0},
                        "output_tokens": 2,
                        "output_tokens_details": {"reasoning_tokens": 0},
                        "total_tokens": 6,
                    },
                },
            },
        ]
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        for event in events:
            self.wfile.write(
                ("event: " + event["type"] + "\n" +
                 "data: " + json.dumps(event, separators=(",", ":")) + "\n\n")
                .encode("utf-8")
            )
        self.wfile.flush()


def verify(path):
    complete = False
    recognized = False
    tools = 0
    try:
        if path.stat().st_size > MAX_BODY:
            return False, 0
        for raw in path.read_text(encoding="utf-8").splitlines():
            event = json.loads(raw)
            if not isinstance(event, dict):
                return False, 0
            if event.get("type") == "turn.completed":
                complete = True
            if event.get("type") in ("item.started", "item.completed"):
                item = event.get("item")
                if not isinstance(item, dict):
                    return False, 0
                if item.get("type") in (
                    "command_execution", "file_change", "mcp_tool_call",
                    "web_search", "tool_call", "function_call"
                ):
                    tools += 1
                if item.get("type") == "agent_message" and SENTINEL in str(
                    item.get("text", "")
                ):
                    recognized = True
    except (OSError, ValueError, TypeError):
        return False, 0
    return complete and recognized and tools == 0, tools


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "serve":
        server = http.server.HTTPServer(("127.0.0.1", PORT), Fixture)
        (ROOT / "fixture-ready").write_text("1", encoding="utf-8")
        server.serve_forever(poll_interval=0.1)
    elif len(sys.argv) == 3 and sys.argv[1] == "verify":
        passed, tools = verify(pathlib.Path(sys.argv[2]))
        print("ARL_AGENT=" + ("completed" if passed else "incomplete"))
        print("ARL_TOOLS=" + str(tools))
        return 0 if passed else 4
    else:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
