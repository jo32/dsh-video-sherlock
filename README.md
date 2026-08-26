# DeepDeck Video Sherlock

[![DSH Plugin](https://img.shields.io/badge/DSH-plugin-5b21b6)](https://dshfind.com/plugins/jo32/dsh-video-sherlock)
[![DeepDeck App](https://img.shields.io/badge/DeepDeck-App-f15a24)](https://github.com/jo32/DeepDeck)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A `dsh-plugin` Cordis Host/Client bundle for local-first, evidence-backed video
investigations in DeepSeek Harness.

> **Best used with [DeepDeck](https://github.com/jo32/DeepDeck).** DeepDeck
> supplies the Apps launcher, standalone app window, app-scoped Workspace and
> canonical AI conversations used to run the injected analysis skills. This
> plugin expects DeepDeck's App runtime service when it is mounted.

## Screenshots

Captured from the standalone DeepDeck desktop App using a real completed
investigation: a 44-minute interview with 558 transcript segments, 12 narrative
sections and 15 inspected frames.

### Case overview

![Video Sherlock case overview in DeepDeck](docs/images/video-sherlock-overview.jpg)

### Synchronized highlight analysis

Selecting a highlight seeks the source video, updates the current narrative and
surfaces the nearest inspected frame with its timestamp and observation.

![Synchronized video highlight analysis](docs/images/video-sherlock-highlight-analysis.jpg)

### Transcript signals and narrative map

![Transcript density and narrative map](docs/images/video-sherlock-narrative-map.jpg)

### Keyframe evidence wall

![Inspected keyframe evidence wall](docs/images/video-sherlock-evidence-wall.jpg)

### Limitations and audit report

![Limitations ledger and full audit report](docs/images/video-sherlock-audit-report.jpg)

### Localized empty workspace

The empty workspace opens the investigation composer directly. This screenshot
shows the English locale; 中文 follows the same layout.

![Video Sherlock localized empty workspace](docs/images/video-sherlock-empty-state.jpg)

## Install with DeepDeck (recommended)

1. Open **Settings → Apps** in DeepDeck.
2. Paste `https://github.com/jo32/dsh-video-sherlock.git` into **Install an App
   plugin**.
3. Choose **Inspect source**, review the detected package and build command,
   then choose **Confirm install**.
4. Restart DeepDeck when prompted.
5. Open **Apps → Video Sherlock** from the sidebar.

For local development, build the checkout and install the resulting local
bundle into the active DeepDeck web profile:

```bash
git clone https://github.com/jo32/dsh-video-sherlock.git
cd dsh-video-sherlock
bun install --frozen-lockfile
bunx tsc --noEmit
bun run build
dsh plugin --profile web add "$PWD"
```

The last command only mounts the Cordis bundle; run it in a DeepDeck-managed
profile so the required App runtime is present.

## Usage examples

- Paste a public video URL or local media path, optionally add an investigation
  focus, then start a complete evidence analysis.
- Open a completed case and drag the video timeline or select an evidence
  highlight to seek directly to the inspected moment.
- Review transcript-density signals, time-proportional narrative chapters,
  semantic topics, inspected keyframes and explicit limitations.
- Keep separate localized presentations of the same evidence while preserving
  the authoritative transcript, timestamps and raw artifacts.

## Features

- Local-first video acquisition, transcription and semantic frame indexing
- Injected `analyze-video` and `video-sherlock-visualize` Agent Skills
- Native video playback with HTTP byte-range streaming
- Draggable timeline, chapter navigation and click-to-seek evidence highlights
- Synchronized narrative context and nearest inspected frame
- Transcript-density chart, topic index, evidence wall and limitations ledger
- Full Markdown audit report with preserved raw evidence
- Guarded same-case artifact serving with path-containment checks
- Responsive monochrome interface for standalone DeepDeck windows
- Chinese and English UI that follows DeepDeck's language setting live

Generated investigations stay in the App Workspace under `video-analyses/` and
are intentionally excluded from Git. Large source videos, transcripts, indexes
and model outputs remain local unless the user explicitly publishes them.

## Internationalization

The App interface follows DeepDeck's active **中文 / English** preference when
the window opens and updates live when that preference changes. Direct visits
to the standalone App URL fall back to the browser's requested language.

UI locale and investigation content language are intentionally separate. The
**Content language** field controls transcription and generated evidence; a UI
language switch localizes navigation, controls, status text and accessibility
labels without translating or mutating existing reports.

## Development

Requires Bun 1.4 or newer.

```bash
bun install --frozen-lockfile
bun run check
bun test
bun run build
```

The Host entry, Client launcher, standalone React App and self-mounting Cordis
bundle are declared in `package.json` and `cordis.patch.yml`. Generated `lib/`
output and `node_modules/` are not committed.

## License

MIT
