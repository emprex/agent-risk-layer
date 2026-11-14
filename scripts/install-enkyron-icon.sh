#!/usr/bin/env bash
# Installs ENKYRON's EK icon for an existing per-user Debian launcher.
# Leaves Exec, Name and all other desktop-entry settings untouched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
launcher="$data_home/applications/enkyron.desktop"
icon="$data_home/icons/enkyron.svg"

if [[ ! -f "$launcher" ]]; then
  printf 'ENKYRON launcher not found: %s\nCreate the launcher first; no files changed.\n' "$launcher" >&2
  exit 1
fi

install -Dm644 "$repo_root/desktop/assets/enkyron.svg" "$icon"

python3 - "$launcher" "$icon" <<'PY'
from pathlib import Path
import sys

launcher = Path(sys.argv[1])
icon = sys.argv[2]
original = launcher.read_text(encoding="utf-8")
lines = original.splitlines(keepends=True)
section_start = next((i for i, line in enumerate(lines)
                      if line.strip() == "[Desktop Entry]"), None)
if section_start is None:
    raise SystemExit(f"Invalid desktop entry (missing [Desktop Entry]): {launcher}")
section_end = next((i for i in range(section_start + 1, len(lines))
                    if lines[i].startswith("[") and lines[i].strip().endswith("]")), len(lines))
icon_line = f"Icon={icon}\n"
for i in range(section_start + 1, section_end):
    if lines[i].startswith("Icon="):
        lines[i] = icon_line
        break
else:
    lines.insert(section_start + 1, icon_line)
updated = "".join(lines)
if updated != original:
    launcher.write_text(updated, encoding="utf-8")
print(f"ENKYRON launcher icon: {icon}")
PY
