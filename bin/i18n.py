#!/usr/bin/env python3
"""Tiny i18n helper so the plugin needs no gettext install.

    python bin/i18n.py pot   # languages/semera-folders.pot from the PHP sources
    python bin/i18n.py mo    # languages/*.po -> languages/*.mo

Only plain strings (no plural forms or contexts) are supported, which is all
this plugin uses.
"""
import ast
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANG = ROOT / "languages"
DOMAIN = "semera-folders"

CALL = re.compile(
    r"(?:esc_html__|esc_attr__|esc_html_e|esc_attr_e|__|_e)\(\s*('(?:[^'\\]|\\.)*')\s*,\s*'" + DOMAIN + r"'\s*\)"
)


def php_string(literal: str) -> str:
    inner = literal[1:-1]
    return inner.replace("\\'", "'").replace("\\\\", "\\")


def po_quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def extract() -> dict:
    found = {}
    for path in sorted((ROOT / "includes").glob("*.php")):
        source = path.read_text(encoding="utf-8")
        for match in CALL.finditer(source):
            line = source.count("\n", 0, match.start()) + 1
            found.setdefault(php_string(match.group(1)), []).append(f"includes/{path.name}:{line}")
    return found


def write_pot() -> None:
    LANG.mkdir(exist_ok=True)
    lines = [
        "# Semera Folders translation template.",
        'msgid ""',
        'msgstr ""',
        '"Project-Id-Version: Semera Folders\\n"',
        '"MIME-Version: 1.0\\n"',
        '"Content-Type: text/plain; charset=UTF-8\\n"',
        '"Content-Transfer-Encoding: 8bit\\n"',
        '"X-Domain: ' + DOMAIN + '\\n"',
        "",
    ]
    for msgid, refs in extract().items():
        lines.append("#: " + " ".join(refs))
        lines.append("msgid " + po_quote(msgid))
        lines.append('msgstr ""')
        lines.append("")
    (LANG / f"{DOMAIN}.pot").write_text("\n".join(lines), encoding="utf-8")
    print("wrote", LANG / f"{DOMAIN}.pot")


def parse_po(path: Path) -> dict:
    messages, msgid, msgstr, target = {}, None, None, None

    def flush():
        if msgid is not None and msgstr is not None:
            messages[msgid] = msgstr

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("msgid "):
            flush()
            msgid, msgstr, target = ast.literal_eval(line[6:]), None, "id"
        elif line.startswith("msgstr "):
            msgstr, target = ast.literal_eval(line[7:]), "str"
        elif line.startswith('"') and target:
            value = ast.literal_eval(line)
            if target == "id":
                msgid += value
            else:
                msgstr += value
    flush()
    return messages


def write_mo(messages: dict, path: Path) -> None:
    entries = sorted((k, v) for k, v in messages.items() if v or k == "")
    ids = b""
    strs = b""
    offsets = []
    for key, value in entries:
        k, v = key.encode("utf-8"), value.encode("utf-8")
        offsets.append((len(ids), len(k), len(strs), len(v)))
        ids += k + b"\0"
        strs += v + b"\0"

    count = len(entries)
    keystart = 7 * 4 + 16 * count
    valuestart = keystart + len(ids)
    # Empty hash table placed right after the two index tables (WordPress insists on that offset).
    out = struct.pack("Iiiiiii", 0x950412DE, 0, count, 7 * 4, 7 * 4 + count * 8, 0, keystart)
    out += b"".join(struct.pack("ii", length, keystart + off) for off, length, _, _ in offsets)
    out += b"".join(struct.pack("ii", length, valuestart + off) for _, _, off, length in offsets)
    path.write_bytes(out + ids + strs)


def compile_mo() -> None:
    for po in sorted(LANG.glob("*.po")):
        messages = parse_po(po)
        write_mo(messages, po.with_suffix(".mo"))
        print(f"{po.name}: {len([v for v in messages.values() if v])} strings")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "pot":
        write_pot()
    elif command == "mo":
        compile_mo()
    else:
        sys.exit(__doc__)
