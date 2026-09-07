#!/usr/bin/env python3
"""Atomically save an Obsidian Markdown note as UTF-8."""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path


WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def sanitize_filename(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip(" .-")
    if not normalized:
        normalized = "obsidian-note"

    path = Path(normalized)
    stem = path.stem if path.suffix.lower() == ".md" else normalized
    stem = stem[:120].rstrip(" .-") or "obsidian-note"
    if stem.upper() in WINDOWS_RESERVED_NAMES:
        stem = f"{stem}-note"
    return f"{stem}.md"


def choose_target(output_dir: Path, filename: str, overwrite: bool) -> Path:
    target = output_dir / filename
    if overwrite or not target.exists():
        return target

    index = 2
    while True:
        candidate = output_dir / f"{target.stem}-{index}{target.suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def normalize_markdown(content: str) -> str:
    normalized_content = content.removeprefix("\ufeff")
    normalized_content = normalized_content.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized_content.endswith("\n"):
        normalized_content += "\n"
    return normalized_content


def save_markdown(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=target.parent,
            prefix=f".{target.stem}-",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, target)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Save Markdown from stdin as an atomic UTF-8 file."
    )
    parser.add_argument("--title", required=True, help="Note title used as the filename.")
    parser.add_argument(
        "--output-dir",
        default="docs/obsidian",
        help="Destination directory. Defaults to docs/obsidian.",
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        help="Read Markdown from a UTF-8 file instead of stdin.",
    )
    parser.add_argument("--filename", help="Optional explicit .md filename.")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace an existing file instead of adding a numeric suffix.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    raw_content = (
        args.input_file.expanduser().read_text(encoding="utf-8-sig")
        if args.input_file
        else sys.stdin.read()
    )
    content = normalize_markdown(raw_content)
    if not content.strip():
        print("Markdown content is empty.", file=sys.stderr)
        return 2
    if not content.startswith("# "):
        print("Markdown must start with a level-one heading.", file=sys.stderr)
        return 3
    expected_heading = f"# {args.title.strip()}"
    actual_heading = content.splitlines()[0]
    if actual_heading != expected_heading:
        print(
            f"Markdown heading does not match --title: {actual_heading!r}",
            file=sys.stderr,
        )
        return 4
    if "\ufffd" in content:
        print("Markdown contains a Unicode replacement character.", file=sys.stderr)
        return 5

    output_dir = Path(args.output_dir).expanduser().resolve()
    filename = sanitize_filename(args.filename or args.title)
    target = choose_target(output_dir, filename, args.overwrite)
    save_markdown(target, content)

    saved_content = target.read_text(encoding="utf-8")
    if "\ufffd" in saved_content:
        target.unlink(missing_ok=True)
        print("Saved Markdown contains a Unicode replacement character.", file=sys.stderr)
        return 6

    print(target)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
