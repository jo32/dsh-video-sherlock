#!/usr/bin/env python3
"""Build the stable Video Sherlock App visualization contract."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
BIN_COUNT = 48


def load_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def relative_artifact(path_value: Any, analysis_dir: Path) -> str:
    if not isinstance(path_value, str) or not path_value.strip():
        return ""
    value = Path(path_value)
    if not value.is_absolute():
        value = analysis_dir / value
    try:
        relative = value.resolve().relative_to(analysis_dir.resolve())
    except (OSError, ValueError):
        return ""
    return relative.as_posix() if value.is_file() else ""


def duration_from(manifest: dict[str, Any], metadata: dict[str, Any], transcript: dict[str, Any]) -> float:
    values = [
        metadata.get("duration_seconds"),
        manifest.get("duration_seconds"),
        (manifest.get("video_probe") or {}).get("duration_seconds"),
    ]
    segments = transcript.get("segments") or []
    if segments:
        values.append(max(number(item.get("end_seconds")) for item in segments))
    return max([number(value) for value in values] + [0.0])


def transcript_density(segments: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    if duration <= 0:
        return []
    bins = [{"start_seconds": duration * index / BIN_COUNT, "characters": 0, "segments": 0} for index in range(BIN_COUNT)]
    for segment in segments:
        start = max(0.0, min(duration, number(segment.get("start_seconds"))))
        end = max(start, min(duration, number(segment.get("end_seconds"), start)))
        text = str(segment.get("text") or "").strip()
        first = min(BIN_COUNT - 1, int(start / duration * BIN_COUNT))
        last = min(BIN_COUNT - 1, int(end / duration * BIN_COUNT))
        span = max(1, last - first + 1)
        for index in range(first, last + 1):
            bins[index]["characters"] += round(len(text) / span)
            bins[index]["segments"] += 1
    peak = max([item["characters"] for item in bins] + [1])
    return [
        {
            "start_seconds": round(item["start_seconds"], 3),
            "intensity": round(item["characters"] / peak, 4),
            "segments": item["segments"],
        }
        for item in bins
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build visualization.json for the Video Sherlock App")
    parser.add_argument("analysis_dir", type=Path)
    args = parser.parse_args()
    analysis_dir = args.analysis_dir.expanduser().resolve()
    raw = analysis_dir / "raw"
    manifest = load_json(analysis_dir / "manifest.json", {})
    metadata = load_json(raw / "metadata.json", {})
    transcript = load_json(raw / "transcript.json", {})
    analysis = load_json(raw / "analysis.json", {})
    observations = load_json(raw / "keyframe-observations.json", {"frames": []})
    candidates = load_json(raw / "candidates.json", {})
    segments = [item for item in transcript.get("segments", []) if isinstance(item, dict)]
    duration = duration_from(manifest, metadata, transcript)

    timeline = []
    for index, item in enumerate(analysis.get("timeline") or []):
        if not isinstance(item, dict):
            continue
        start = max(0.0, number(item.get("start_seconds")))
        end = max(start, number(item.get("end_seconds"), duration or start))
        timeline.append({
            "id": f"topic-{index + 1}",
            "start_seconds": round(start, 3),
            "end_seconds": round(end, 3),
            "topic": str(item.get("topic") or f"Topic {index + 1}"),
            "evidence": str(item.get("evidence") or ""),
        })

    frames = []
    confidence_counts = {"high": 0, "medium": 0, "low": 0, "unknown": 0}
    for index, frame in enumerate(observations.get("frames") or []):
        if not isinstance(frame, dict):
            continue
        path = relative_artifact(frame.get("path"), analysis_dir)
        if not path:
            continue
        confidence = str(frame.get("confidence") or "unknown").lower()
        if confidence not in confidence_counts:
            confidence = "unknown"
        confidence_counts[confidence] += 1
        frames.append({
            "id": str(frame.get("id") or f"frame-{index + 1}"),
            "timestamp_seconds": round(max(0.0, number(frame.get("timestamp_seconds"))), 3),
            "path": path,
            "source": str(frame.get("source") or "selected-frame"),
            "query": str(frame.get("query") or ""),
            "observation": str(frame.get("observation") or ""),
            "visible_text": str(frame.get("visible_text") or ""),
            "relevance": str(frame.get("relevance") or ""),
            "confidence": confidence,
            "similarity": frame.get("similarity") if isinstance(frame.get("similarity"), (int, float)) else None,
        })

    transcript_engine = str(manifest.get("transcript_engine") or transcript.get("engine") or "none")
    candidate_items = candidates.get("candidates") if isinstance(candidates, dict) else candidates
    candidate_count = len(candidate_items) if isinstance(candidate_items, list) else 0
    visualization = {
        "schema_version": SCHEMA_VERSION,
        "generated_from": "video-sherlock-visualize",
        "status": "complete" if (analysis_dir / "report.md").is_file() else "partial",
        "title": str(metadata.get("title") or analysis_dir.name),
        "source": str(metadata.get("source_url") or manifest.get("requested_source") or ""),
        "creator": str(metadata.get("uploader") or ""),
        "duration_seconds": round(duration, 3),
        "language": str(manifest.get("language") or transcript.get("language") or "unknown"),
        "transcript_engine": transcript_engine,
        "summary": str(analysis.get("summary") or ""),
        "topics": [str(item) for item in (analysis.get("topics") or []) if str(item).strip()],
        "key_points": [str(item) for item in (analysis.get("key_points") or []) if str(item).strip()],
        "limitations": [str(item) for item in (analysis.get("limitations") or []) if str(item).strip()],
        "timeline": timeline,
        "transcript_density": transcript_density(segments, duration),
        "frames": frames,
        "metrics": {
            "transcript_segments": len(segments),
            "transcript_characters": sum(len(str(item.get("text") or "")) for item in segments),
            "candidate_moments": candidate_count,
            "inspected_frames": len(frames),
            "timeline_sections": len(timeline),
            "confidence": confidence_counts,
        },
    }
    output = analysis_dir / "visualization.json"
    output.write_text(json.dumps(visualization, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
