"""Build the Persian SRT subtitle track from script.json + timings.json."""

from __future__ import annotations

import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO_DIR = os.path.dirname(HERE)


def srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def wrap(text: str, width: int = 58) -> str:
    """Greedy wrap that keeps RTL words intact (Persian phrases are short)."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        candidate = (cur + " " + w).strip()
        if len(candidate) <= width:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?؟])\s+", text.strip())
    return [p for p in parts if p]


def main() -> None:
    script = json.load(open(os.path.join(VIDEO_DIR, "script.json"), encoding="utf-8"))
    timings = json.load(open(os.path.join(HERE, "timings.json"), encoding="utf-8-sig"))
    beats = script["beats"]
    tbeats = timings["beats"]

    cues: list[tuple[float, float, str]] = []
    cursor = 0.0
    for beat, tm in zip(beats, tbeats):
        start = cursor + tm["lead"]
        end = start + tm["audio"]
        text = beat["narration"].strip()
        sentences = split_sentences(text)

        # keep short beats on a single cue; only split long ones, balanced by chars
        if len(text) <= 95 or len(sentences) < 2:
            groups = [text]
        else:
            half = len(text) / 2
            acc, cut = 0, 1
            for idx, s in enumerate(sentences):
                acc += len(s) + 1
                if acc >= half:
                    cut = idx + 1
                    break
            groups = [" ".join(sentences[:cut]), " ".join(sentences[cut:])] if cut < len(sentences) else [text]

        total_chars = sum(len(g) for g in groups)
        span = end - start
        at = start
        for g in groups:
            dur = span * len(g) / total_chars
            cues.append((at, min(at + dur, end), wrap(g)))
            at += dur
        cursor += tm["segment"]

    out = os.path.join(VIDEO_DIR, "Webautomator-Tutorial-FA.srt")
    with open(out, "w", encoding="utf-8") as f:
        for i, (s, e, text) in enumerate(cues, start=1):
            f.write(f"{i}\n{srt_time(s)} --> {srt_time(e)}\n{text}\n\n")
    print(f"wrote {out} ({len(cues)} cues, {cursor:.1f}s total)")


if __name__ == "__main__":
    main()
