---
name: video-sherlock-visualize
description: Run the injected analyze-video evidence workflow, then convert its report artifacts into the visualization.json contract consumed by the Video Sherlock DeepDeck App. Use when the App asks to investigate a video, create an evidence dashboard, or refresh an App case file.
---

# Video Sherlock Visualize

Create a complete, visualizable video investigation. This skill extends `analyze-video`; it does not replace or weaken that skill's evidence rules.

## Required workflow

1. Load and follow the `analyze-video` skill for the requested URL or local video.
2. Use exactly the analysis directory requested by the App. It must be a dedicated child of `./video-analyses/` and must not contain unrelated files.
3. Complete the full `analyze-video` workflow unless the App explicitly requests metadata-only mode. For a full run, do not continue until strict report assembly succeeds and `report.md` exists.
4. Resolve this skill directory and generate the App visualization:

```bash
python3 <this-skill-dir>/scripts/build_visualization.py "<analysis-dir>"
```

5. Read `<analysis-dir>/visualization.json` and verify that:
   - `schema_version` is `1`;
   - duration, transcript source, timeline and evidence counts agree with the raw artifacts;
   - every frame path stays inside the analysis directory and resolves to an existing image;
   - no visualization text claims more than the underlying transcript or frame observation.
6. Return the absolute paths to `report.md` (when produced), `visualization.json`, and the analysis directory. State whether the run was full or metadata-only and which stages were unavailable.

## App-specific constraints

- The App consumes files; do not start a web server or create standalone HTML.
- Preserve all `analyze-video` raw artifacts. Never trade auditability for visual polish.
- Do not invent topics, sentiment, speaker identity, motion, causality, or OCR. The visualization script only normalizes completed evidence.
- If preparation fails, repair and rerun the same analysis directory as instructed by `analyze-video`; never delete the case directory unless the user asks.
- If metadata-only mode was requested, still run the visualization script. It will produce a partial dashboard and mark unavailable evidence honestly.
