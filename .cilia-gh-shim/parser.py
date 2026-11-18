"""Markdown review-body → structured concern list.

Used by gh-shim to translate `gh pr review --body-file` content into a
sequence of `register_review_concern` MCP calls. Lossy by design — we
extract what we can (severity tag, file:line ref, narrative text) and
leave the rest as the concern_text field.
"""
from __future__ import annotations

import re
import sys
from typing import Optional, TypedDict


class Concern(TypedDict):
    severity: str
    file_path: Optional[str]
    line_range: Optional[str]
    concern_text: str


SEVERITY_RE = re.compile(r"\[(critical|high|medium|low)\]", re.IGNORECASE)
# Match `path/to/file.ext:NN` or `path/to/file.ext:NN-MM` inside backticks.
FILE_LINE_RE = re.compile(r"`([^`]+\.[a-zA-Z0-9]+):(\d+(?:-\d+)?)`")
# Bare-file fallback. Requires an extension to avoid matching `bar()` style
# function refs.
FILE_ONLY_RE = re.compile(r"`([^`/\s]+\.[a-zA-Z0-9]+)`")
# Same but allows directory separators for nested paths.
FILE_ONLY_PATH_RE = re.compile(r"`([^\s`]+/[^\s`]+\.[a-zA-Z0-9]+)`")
# Fence marker (after lstrip): 3+ backticks or 3+ tildes. Both the character
# and the length matter for CommonMark open/close matching.
FENCE_RE = re.compile(r"^(`{3,}|~{3,})")


def parse_review_body(body: str) -> list[Concern]:
    """Extract structured concerns from a markdown review body.

    Each top-level bullet (`- ...` or `* ...`) becomes one Concern.
    `[severity]` tags map to severity (default `medium`). `path:lines`
    in backticks populate file_path/line_range. Anything else stays in
    concern_text.

    Skips bullets inside CommonMark code regions so they're not misread as
    real concerns:
      - Fenced code blocks (``` or ~~~). Tracks the opening marker char +
        length so a ``` fence isn't closed by ~~~ and a ```` fence isn't
        closed by an inner ``` (CommonMark §4.5).
      - Indented code blocks (4-space-indented line after a blank line,
        CommonMark §4.4). Terminates on the next blank line.
    Emits a stderr warning if a fence opens but never closes — the bullets
    after it are silently dropped, and a typo in the reviewer's fence
    marker is the most likely cause.
    """
    out: list[Concern] = []
    # Open fence tracked as (marker_char, opening_length). None when not
    # in a fence. Close requires same char and length >= opening, with no
    # other non-whitespace content on the close line.
    fence_open: Optional[tuple[str, int]] = None
    # Indented code block state. `prev_blank` starts True so a doc that
    # opens with an indented line is treated as a block (matches CommonMark
    # "start of document is preceded by a blank line").
    in_indented = False
    prev_blank = True
    for line in body.splitlines():
        is_blank = line.strip() == ""
        was_blank = prev_blank
        prev_blank = is_blank
        if is_blank:
            # Blank lines terminate an indented code block.
            in_indented = False
            continue

        # Indented code block detection must run BEFORE fence detection:
        # the fence regex matches on `line.lstrip()`, so a fence-shaped
        # line inside an indented block would otherwise be misclassified
        # as a real fence open/close (CommonMark §4.4 — once inside an
        # indented block, fence markers are literal content).
        if (
            not in_indented
            and fence_open is None
            and was_blank
            and (line.startswith("    ") or line.startswith("\t"))
        ):
            in_indented = True
        if in_indented:
            continue

        stripped = line.lstrip()

        fence_match = FENCE_RE.match(stripped)
        if fence_match:
            marker = fence_match.group(1)
            char = marker[0]
            length = len(marker)
            if fence_open is None:
                fence_open = (char, length)
                continue
            # Inside a fence: only a same-char marker of >= opening length,
            # with an empty tail, closes the fence (CommonMark §4.5).
            if (
                char == fence_open[0]
                and length >= fence_open[1]
                and not stripped[length:].strip()
            ):
                fence_open = None
                continue
            # else: fence-marker-shaped line inside a non-matching fence is
            # just content — fall through to the fence-content skip below.

        if fence_open is not None:
            continue

        if not (stripped.startswith("- ") or stripped.startswith("* ")):
            continue
        text = stripped[2:].strip()
        if not text:
            continue

        sev_match = SEVERITY_RE.search(text)
        if sev_match:
            severity = sev_match.group(1).lower()
            text = text.replace(sev_match.group(0), "", 1).strip()
            text = text.lstrip(" -—:")
        else:
            severity = "medium"

        fl_match = FILE_LINE_RE.search(text)
        if fl_match:
            file_path: Optional[str] = fl_match.group(1)
            line_range: Optional[str] = fl_match.group(2)
        else:
            # Try a path-with-slashes match before the bare-name match so
            # nested refs like `services/cilia/src/lib.rs` win.
            fp_match = FILE_ONLY_PATH_RE.search(text) or FILE_ONLY_RE.search(text)
            file_path = fp_match.group(1) if fp_match else None
            line_range = None

        out.append(
            Concern(
                severity=severity,
                file_path=file_path,
                line_range=line_range,
                concern_text=text,
            )
        )

    if fence_open is not None:
        marker_str = fence_open[0] * fence_open[1]
        print(
            f"cilia-gh-shim/parser: unclosed {marker_str} fence — all bullets "
            f"after it were dropped. Check review body for typos.",
            file=sys.stderr,
        )

    return out
