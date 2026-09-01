import React, { FormEvent, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createTranslator, resolveUiLocale, type CopyKey, type Translate, type UiLocale } from './i18n'
import './styles.css'
import './player.css'
import './layout-fix.css'
import './vercel.css'
import './features.css'

const APP_ID = 'video-sherlock-app'
const API = '/api/apps/video-sherlock-app'
const CHANNEL = 'deepdeck-app-conversations-v1'
const LOCALE_CHANNEL = 'deepdeck-video-sherlock-locale-v1'

type I18nValue = {
  locale: UiLocale
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('Video Sherlock i18n context is missing')
  return value
}

function requestedBrowserLocales(): string[] {
  if (typeof navigator === 'undefined') return []
  return [...(navigator.languages ?? []), navigator.language].filter(Boolean)
}

function initialUiLocale(): UiLocale {
  const requested = new URLSearchParams(window.location.search).get('locale')
  return resolveUiLocale(requested, requestedBrowserLocales())
}

type ReportStatus = 'complete' | 'processing'

type ReportSummary = {
  id: string
  title: string
  source: string
  summary: string
  status: ReportStatus
  updatedAt: string
  visualized?: boolean
  pending?: boolean
}

type TimelineItem = {
  id: string
  start_seconds: number
  end_seconds: number
  topic: string
  evidence: string
}

type EvidenceFrame = {
  id: string
  timestamp_seconds: number
  path: string
  source: string
  query: string
  observation: string
  visible_text: string
  relevance: string
  confidence: string
  similarity: number | null
}

type Visualization = {
  schema_version: number
  status: 'complete' | 'partial'
  title: string
  source: string
  creator: string
  duration_seconds: number
  language: string
  transcript_engine: string
  summary: string
  topics: string[]
  key_points: string[]
  limitations: string[]
  timeline: TimelineItem[]
  transcript_density: Array<{ start_seconds: number; intensity: number; segments: number }>
  frames: EvidenceFrame[]
  metrics: {
    transcript_segments: number
    transcript_characters: number
    candidate_moments: number
    inspected_frames: number
    timeline_sections: number
    confidence: Record<string, number>
  }
}

type TranscriptSegment = {
  start_seconds: number
  end_seconds: number
  text: string
}

type Transcript = {
  engine: string
  language: string
  segments: TranscriptSegment[]
}

type ReportDetail = ReportSummary & {
  markdown: string
  visualization: Visualization | null
  transcript?: Transcript
  videoPath?: string
}

type AgentMessage = {
  source?: string
  type?: string
  targetClientId?: string
  appId?: string
  requestId?: string
  status?: string
  content?: string
  error?: string
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

function formatDate(value: string, locale = 'en-US'): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return ''
  }
}

function artifactUrl(caseId: string, path: string): string {
  return `${API}/artifact?id=${encodeURIComponent(caseId)}&path=${encodeURIComponent(path)}`
}

function createCaseId(): string {
  return `case-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-').toLowerCase()}`
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

function normalizeVisualization(value: Visualization | null): Visualization | null {
  if (!value || typeof value !== 'object' || value.schema_version !== 1) return null
  const metrics = value.metrics && typeof value.metrics === 'object' ? value.metrics : {} as Visualization['metrics']
  return {
    ...value,
    title: typeof value.title === 'string' ? value.title : '',
    source: typeof value.source === 'string' ? value.source : '',
    creator: typeof value.creator === 'string' ? value.creator : '',
    duration_seconds: Number.isFinite(Number(value.duration_seconds)) ? Number(value.duration_seconds) : 0,
    language: typeof value.language === 'string' ? value.language : 'unknown',
    transcript_engine: typeof value.transcript_engine === 'string' ? value.transcript_engine : 'none',
    summary: typeof value.summary === 'string' ? value.summary : '',
    topics: Array.isArray(value.topics) ? value.topics.filter(item => typeof item === 'string') : [],
    key_points: Array.isArray(value.key_points) ? value.key_points.filter(item => typeof item === 'string') : [],
    limitations: Array.isArray(value.limitations) ? value.limitations.filter(item => typeof item === 'string') : [],
    timeline: Array.isArray(value.timeline) ? value.timeline.filter(item => item && typeof item === 'object') : [],
    transcript_density: Array.isArray(value.transcript_density) ? value.transcript_density.filter(item => item && typeof item === 'object') : [],
    frames: Array.isArray(value.frames) ? value.frames.filter(item => item && typeof item === 'object') : [],
    metrics: {
      transcript_segments: Number(metrics.transcript_segments) || 0,
      transcript_characters: Number(metrics.transcript_characters) || 0,
      candidate_moments: Number(metrics.candidate_moments) || 0,
      inspected_frames: Number(metrics.inspected_frames) || 0,
      timeline_sections: Number(metrics.timeline_sections) || 0,
      confidence: metrics.confidence && typeof metrics.confidence === 'object' ? metrics.confidence : {},
    },
  }
}

function rollingCaptionOverlap(previous: string, current: string): number {
  const maximum = Math.min(previous.length, current.length, 800)
  for (let length = maximum; length >= 6; length -= 1) {
    if (previous.endsWith(current.slice(0, length))) return length
  }
  return 0
}

function normalizeCaptionSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized: TranscriptSegment[] = []
  let previous: TranscriptSegment | undefined
  for (const segment of segments) {
    let text = segment.text.trim()
    if (previous && segment.start_seconds - previous.end_seconds <= 0.35) {
      text = text.slice(rollingCaptionOverlap(previous.text.trim(), text)).trim()
    }
    if (text) normalized.push({ ...segment, text })
    previous = segment
  }
  return normalized
}

function captionsAt(segments: TranscriptSegment[], time: number): TranscriptSegment[] {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (segments[middle].start_seconds <= time) low = middle + 1
    else high = middle
  }
  const result: TranscriptSegment[] = []
  for (let index = Math.max(0, low - 3); index < Math.min(segments.length, low + 2); index += 1) {
    const segment = segments[index]
    if (time >= segment.start_seconds && time < segment.end_seconds) result.push(segment)
  }
  return result.slice(-1)
}

function BrandMark() {
  return <div className="brandMark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.5" /><path d="m14.6 14.6 5.15 5.15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="m8.75 7.5 3.75 2.5-3.75 2.5v-5Z" fill="currentColor" /></svg></div>
}

function RefreshIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M15.25 6.75A6.25 6.25 0 1 0 16 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M15.25 3.75v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.75 6.25h10.5M8 3.75h4M6.25 6.25l.5 9h6.5l.5-9M8.5 8.75v4M11.5 8.75v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function EmptyStage({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n()
  return (
    <section className="emptyStage">
      <div className="emptyContent">
        <div className="emptyIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><rect x="3.75" y="5.25" width="12.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="m8.25 9 4.5 3-4.5 3V9Z" fill="currentColor" /><circle cx="16.75" cy="16.75" r="3.25" fill="#050505" stroke="currentColor" strokeWidth="1.5" /><path d="m19.15 19.15 1.6 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </div>
        <h1>{t('empty.title')}</h1>
        <p>{t('empty.description')}</p>
        <button type="button" className="emptyAction" onClick={onCreate}>{t('action.newInvestigation')} <span aria-hidden="true">→</span></button>
        <div className="emptyCapabilities" aria-label={t('empty.outputs')}>
          {[t('empty.transcript'), t('empty.timeline'), t('empty.report')].map(item => <span key={item}><i aria-hidden="true">✓</i>{item}</span>)}
        </div>
      </div>
    </section>
  )
}

function Metric({ value, label, tone }: { value: string; label: string; tone: number }) {
  return <div className="metric" style={{ '--tone': `${tone}deg` } as React.CSSProperties}><strong>{value}</strong><span>{label}</span></div>
}

function Panel({ title, detail, children, className = '' }: React.PropsWithChildren<{ title: string; detail?: string; className?: string }>) {
  return <section className={`vizPanel ${className}`}><header><b>{title}</b><span>{detail}</span></header>{children}</section>
}

function EvidencePlayer({ visualization, transcript, caseId, videoPath, videoRef, currentTime, onTimeChange, onSeek }: {
  visualization: Visualization
  transcript?: Transcript
  caseId: string
  videoPath: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  currentTime: number
  onTimeChange: (time: number) => void
  onSeek: (time: number, autoplay?: boolean, reveal?: boolean) => void
}) {
  const { t } = useI18n()
  const captionSegments = useMemo(() => normalizeCaptionSegments(transcript?.segments ?? []), [transcript])
  const [captionsEnabled, setCaptionsEnabled] = useState(captionSegments.length > 0)
  useEffect(() => setCaptionsEnabled(captionSegments.length > 0), [transcript])
  const activeCaptions = captionsEnabled ? captionsAt(captionSegments, currentTime) : []
  const duration = Math.max(1, visualization.duration_seconds || 0)
  const progress = Math.max(0, Math.min(100, currentTime / duration * 100))
  const activeTopic = visualization.timeline.find(item => currentTime >= item.start_seconds && currentTime < item.end_seconds)
  const nearestFrame = visualization.frames.reduce<EvidenceFrame | null>((nearest, frame) => {
    if (!nearest) return frame
    return Math.abs(frame.timestamp_seconds - currentTime) < Math.abs(nearest.timestamp_seconds - currentTime) ? frame : nearest
  }, null)
  const activeFrame = nearestFrame && Math.abs(nearestFrame.timestamp_seconds - currentTime) <= 18 ? nearestFrame : null
  const poster = visualization.frames[0]?.path ? artifactUrl(caseId, visualization.frames[0].path) : undefined
  return (
    <section className="evidencePlayer" aria-label={t('player.aria')}>
      <div className="playerHeading"><div><span className="liveDot" />{t('player.heading')}</div><div className="playerHeadingActions"><p>{t('player.help')}</p>{captionSegments.length > 0 && <button type="button" className={captionsEnabled ? 'captionToggle active' : 'captionToggle'} onClick={() => setCaptionsEnabled(value => !value)} aria-pressed={captionsEnabled} title={t('player.captionsSource', { engine: transcript?.engine || t('evidence.confidenceUnknown') })}>CC · {captionsEnabled ? t('player.captionsOn') : t('player.captionsOff')}</button>}</div></div>
      <div className="playerGrid">
        <div className="videoStage">
          <video
            ref={videoRef}
            src={artifactUrl(caseId, videoPath)}
            poster={poster}
            controls
            preload="metadata"
            playsInline
            onLoadedMetadata={event => onTimeChange(event.currentTarget.currentTime)}
            onTimeUpdate={event => onTimeChange(event.currentTarget.currentTime)}
          />
          {!!activeCaptions.length && <div className="captionOverlay" aria-live="off">{activeCaptions.map((segment, index) => <span key={`${segment.start_seconds}-${index}`}>{segment.text}</span>)}</div>}
          <div className="timeReadout"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
        </div>
        <aside className="nowPanel">
          <span className="nowLabel">{t('player.now')}</span>
          <strong>{activeTopic?.topic || t('player.browseTitle')}</strong>
          <p>{activeTopic?.evidence || t('player.browseBody')}</p>
          {activeFrame && <button className="activeEvidence" onClick={() => onSeek(activeFrame.timestamp_seconds, false, false)}>
            <img src={artifactUrl(caseId, activeFrame.path)} alt={t('player.nearestFrameAlt')} />
            <span><small>{t('player.nearestFrame')} · {formatTime(activeFrame.timestamp_seconds)}</small><b>{activeFrame.observation}</b></span>
          </button>}
        </aside>
      </div>
      <div className="scrubber" style={{ '--progress': `${progress}%` } as React.CSSProperties}>
        <div className="scrubberTrack">
          <div className="topicBands" aria-hidden="true">
            {visualization.timeline.map((item, index) => <i key={item.id} style={{ left: `${Math.max(0, item.start_seconds / duration * 100)}%`, width: `${Math.max(.35, (item.end_seconds - item.start_seconds) / duration * 100)}%`, '--topic': `${index * 28}deg` } as React.CSSProperties} />)}
          </div>
          <div className="playbackProgress" aria-hidden="true" />
          <div className="playbackHead" aria-hidden="true"><span /></div>
          <input aria-label={t('player.timeline')} type="range" min={0} max={duration} step={0.1} value={Math.min(duration, currentTime)} onChange={event => onSeek(Number(event.target.value), false, false)} />
          <div className="evidenceMarkers">
            {visualization.frames.map(frame => <button key={frame.id} className={activeFrame?.id === frame.id ? 'active' : ''} style={{ left: `${Math.max(0, Math.min(100, frame.timestamp_seconds / duration * 100))}%` }} title={`${formatTime(frame.timestamp_seconds)} · ${frame.query || frame.observation}`} aria-label={t('player.jumpToEvidence', { time: formatTime(frame.timestamp_seconds) })} onClick={() => onSeek(frame.timestamp_seconds, true, false)}><span /></button>)}
          </div>
        </div>
        <div className="scrubberAxis"><span>00:00</span><b>{t('player.highlights', { count: visualization.frames.length })}</b><span>{formatTime(duration)}</span></div>
      </div>
      <div className="chapterStrip">
        {visualization.timeline.map(item => <button key={item.id} className={activeTopic?.id === item.id ? 'active' : ''} onClick={() => onSeek(item.start_seconds, false, false)}><span>{formatTime(item.start_seconds)}</span>{item.topic}</button>)}
      </div>
    </section>
  )
}

function DensityChart({ values, engine }: { values: Visualization['transcript_density']; engine: string }) {
  const { t } = useI18n()
  if (!values.length) return null
  return (
    <Panel title={t('density.title')} detail={t('density.detail', { engine: engine || t('evidence.confidenceUnknown') })}>
      <div className="densityChart">
        {values.map((item, index) => (
          <div className="densityBar" key={index} style={{ height: `${Math.max(5, item.intensity * 100)}%` }} title={`${formatTime(item.start_seconds)} · ${t('density.segments', { count: item.segments })}`} />
        ))}
      </div>
      <div className="axis"><span>00:00</span><span>{t('density.activity')}</span><span>{formatTime(values.at(-1)?.start_seconds ?? 0)}</span></div>
    </Panel>
  )
}

function NarrativeMap({ timeline, duration, currentTime, onSeek }: { timeline: TimelineItem[]; duration: number; currentTime: number; onSeek: (time: number) => void }) {
  const { t } = useI18n()
  if (!timeline.length) return null
  const safeDuration = Math.max(1, duration)
  return (
    <Panel title={t('narrative.title')} detail={t('narrative.detail')}>
      <div className="timelineTrack">
        {timeline.map((item, index) => {
          const left = Math.max(0, Math.min(100, item.start_seconds / safeDuration * 100))
          const right = Math.max(left + 1, Math.min(100, item.end_seconds / safeDuration * 100))
          const active = currentTime >= item.start_seconds && currentTime < item.end_seconds
          return <button className={active ? 'active' : ''} key={item.id} title={`${formatTime(item.start_seconds)} · ${item.topic}`} onClick={() => onSeek(item.start_seconds)} style={{ left: `${left}%`, width: `${right - left}%`, '--topic': `${index * 28}deg` } as React.CSSProperties} />
        })}
      </div>
      <div className="topicGrid">
        {timeline.map((item) => {
          const active = currentTime >= item.start_seconds && currentTime < item.end_seconds
          return <article className={active ? 'active' : ''} key={item.id} role="button" tabIndex={0} onClick={() => onSeek(item.start_seconds)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSeek(item.start_seconds) } }}><b>{formatTime(item.start_seconds)} · {item.topic}</b><p>{item.evidence}</p></article>
        })}
      </div>
    </Panel>
  )
}

function EvidenceWall({ frames, caseId, currentTime, onSeek }: { frames: EvidenceFrame[]; caseId: string; currentTime: number; onSeek: (time: number, autoplay?: boolean) => void }) {
  const { t } = useI18n()
  if (!frames.length) return null
  return (
    <Panel title={t('evidence.title')} detail={t('evidence.detail', { count: frames.length })} className="evidencePanel">
      <div className="evidenceWall">
        {frames.map((frame) => (
          <article className={`evidenceCard ${Math.abs(frame.timestamp_seconds - currentTime) <= 18 ? 'active' : ''}`} key={frame.id} role="button" tabIndex={0} onClick={() => onSeek(frame.timestamp_seconds, true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSeek(frame.timestamp_seconds, true) } }}>
            <div className="frameImage">
              <img src={artifactUrl(caseId, frame.path)} loading="lazy" alt={frame.observation || t('evidence.frameAlt')} />
              <span>▶ {formatTime(frame.timestamp_seconds)}</span>
            </div>
            <div className="frameCopy">
              <b>{frame.query || frame.source || t('evidence.selected')}</b>
              <p>{frame.observation || frame.relevance || t('evidence.awaiting')}</p>
              <footer><em className={`confidence ${frame.confidence}`}>{frame.confidence || t('evidence.confidenceUnknown')}</em><span>{frame.source}</span></footer>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  )
}

function EvidenceDashboard({ visualization, transcript, caseId, videoPath }: { visualization: Visualization; transcript?: Transcript; caseId: string; videoPath?: string }) {
  const { locale, t } = useI18n()
  const metrics = visualization.metrics ?? {} as Visualization['metrics']
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const seek = useCallback((time: number, autoplay = false, reveal = true) => {
    const next = Math.max(0, Math.min(visualization.duration_seconds || Number.MAX_SAFE_INTEGER, Number(time) || 0))
    setCurrentTime(next)
    if (videoRef.current) {
      videoRef.current.currentTime = next
      if (autoplay) void videoRef.current.play().catch(() => {})
    }
    if (reveal) playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [visualization.duration_seconds])
  return (
    <div className="dashboard">
      {visualization.summary && <div className="summaryCallout"><span>{t('dashboard.summary')}</span><p>{visualization.summary}</p></div>}
      {videoPath && <div ref={playerRef}><EvidencePlayer visualization={visualization} transcript={transcript} caseId={caseId} videoPath={videoPath} videoRef={videoRef} currentTime={currentTime} onTimeChange={setCurrentTime} onSeek={seek} /></div>}
      {!videoPath && <div className="videoUnavailable">{t('dashboard.videoUnavailable')}</div>}
      <div className="metrics">
        <Metric value={formatTime(visualization.duration_seconds)} label={t('metrics.duration')} tone={0} />
        <Metric value={Number(metrics.transcript_segments || 0).toLocaleString(locale)} label={t('metrics.transcriptSegments')} tone={35} />
        <Metric value={Number(metrics.inspected_frames || 0).toLocaleString(locale)} label={t('metrics.inspectedFrames')} tone={70} />
        <Metric value={Number(metrics.timeline_sections || 0).toLocaleString(locale)} label={t('metrics.topicSections')} tone={105} />
      </div>
      <DensityChart values={visualization.transcript_density ?? []} engine={visualization.transcript_engine} />
      <NarrativeMap timeline={visualization.timeline ?? []} duration={visualization.duration_seconds} currentTime={currentTime} onSeek={seek} />
      {!!visualization.topics?.length && <Panel title={t('topics.title')} detail={t('topics.detail', { count: visualization.topics.length })}><div className="topicChips">{visualization.topics.map(topic => <span key={topic}>{topic}</span>)}</div></Panel>}
      <EvidenceWall frames={visualization.frames ?? []} caseId={caseId} currentTime={currentTime} onSeek={seek} />
      {!!visualization.limitations?.length && <Panel title={t('limitations.title')} detail={t('limitations.detail')}><ul className="limitations">{visualization.limitations.map(item => <li key={item}>{item}</li>)}</ul></Panel>}
    </div>
  )
}

function ReportDocument({ markdown, caseId }: { markdown: string; caseId: string }) {
  const { t } = useI18n()
  const blocks = useMemo(() => {
    const lines = markdown.replace(/\r/g, '').split('\n')
    const result: React.ReactNode[] = []
    let paragraph: string[] = []
    const flush = () => {
      if (!paragraph.length) return
      result.push(<p key={`p-${result.length}`}>{paragraph.join(' ')}</p>)
      paragraph = []
    }
    lines.forEach((line) => {
      const heading = line.match(/^(#{1,3})\s+(.+)$/)
      const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (!line.trim()) { flush(); return }
      if (heading) {
        flush()
        const level = heading[1].length
        if (level === 1) result.push(<h1 key={`h-${result.length}`}>{heading[2]}</h1>)
        else if (level === 2) result.push(<h2 key={`h-${result.length}`}>{heading[2]}</h2>)
        else result.push(<h3 key={`h-${result.length}`}>{heading[2]}</h3>)
        return
      }
      if (image) {
        flush()
        result.push(<figure key={`img-${result.length}`}><img src={artifactUrl(caseId, image[2])} loading="lazy" alt={image[1]} /><figcaption>{image[1]}</figcaption></figure>)
        return
      }
      if (line.startsWith('- ')) {
        flush()
        result.push(<div className="reportBullet" key={`li-${result.length}`}>{line.slice(2)}</div>)
        return
      }
      if (/^\|.+\|$/.test(line)) {
        flush()
        result.push(<div className="reportTableLine" key={`table-${result.length}`}>{line.split('|').filter(Boolean).map((cell, index) => <span key={index}>{cell.trim()}</span>)}</div>)
        return
      }
      paragraph.push(line.trim())
    })
    flush()
    return result
  }, [markdown, caseId])
  if (!markdown) return null
  return <details className="reportDocument"><summary>{t('report.full')} <span>report.md</span></summary><article>{blocks}</article></details>
}

function CaseReader({ report, loading, onCreate }: { report: ReportDetail | null; loading: boolean; onCreate: () => void }) {
  const { t } = useI18n()
  if (loading) return <div className="loadingStage"><div className="scanMark"><span /></div><p>{t('case.loadingGraph')}</p></div>
  if (!report) return <EmptyStage onCreate={onCreate} />
  const visualization = normalizeVisualization(report.visualization)
  return (
    <div className="caseReader">
      <header className="caseHeader">
        <div className="eyebrow">{report.status === 'complete' ? t('case.verified') : t('case.inProgress')}</div>
        <h1>{report.title}</h1>
        <p>{report.source || t('case.localSource')}</p>
      </header>
      {visualization ? <EvidenceDashboard visualization={visualization} transcript={report.transcript} caseId={report.id} videoPath={report.videoPath} /> : (
        <div className="pendingCard"><div className="scanMark small"><span /></div><div><b>{t('case.pendingTitle')}</b><p>{t('case.pendingBody')}</p></div></div>
      )}
      <ReportDocument markdown={report.markdown} caseId={report.id} />
    </div>
  )
}

function Composer({ onSubmit, busy, open, onClose }: { onSubmit: (payload: Record<string, unknown>) => void | Promise<void>; busy: boolean; open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const [source, setSource] = useState('')
  const [focus, setFocus] = useState('')
  const [language, setLanguage] = useState('auto')
  const [metadataOnly, setMetadataOnly] = useState(false)
  const [noModelFetch, setNoModelFetch] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!source.trim() || busy) return
    void onSubmit({ source: source.trim(), focus: focus.trim(), language, metadataOnly, noModelFetch })
  }
  return (
    <aside className={`composer ${open ? 'open' : ''}`}>
      <div className="composerTop"><div className="eyebrow">{t('composer.eyebrow')}</div><button type="button" className="composerClose" onClick={onClose} aria-label={t('action.closeComposer')}>×</button></div>
      <h2>{t('composer.title')}</h2>
      <p className="composerIntro">{t('composer.intro')}</p>
      <form onSubmit={submit}>
        <label><span><b>{t('composer.source')}</b><em>{t('composer.sourceHint')}</em></span><input required maxLength={4000} value={source} onChange={event => setSource(event.target.value)} placeholder={t('composer.sourcePlaceholder')} /></label>
        <label><span><b>{t('composer.focus')}</b><em>{t('composer.optional')}</em></span><textarea maxLength={4000} value={focus} onChange={event => setFocus(event.target.value)} placeholder={t('composer.focusPlaceholder')} /></label>
        <label><span><b>{t('composer.contentLanguage')}</b></span><select value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">{t('composer.languageAuto')}</option><option value="zh">{t('composer.languageZh')}</option><option value="en">{t('composer.languageEn')}</option><option value="ja">{t('composer.languageJa')}</option><option value="ko">{t('composer.languageKo')}</option></select></label>
        <div className="toggles"><label><input type="checkbox" checked={metadataOnly} onChange={event => setMetadataOnly(event.target.checked)} />{t('composer.metadataOnly')}</label><label><input type="checkbox" checked={noModelFetch} onChange={event => setNoModelFetch(event.target.checked)} />{t('composer.cachedModelsOnly')}</label></div>
        <button className="analyzeButton" disabled={busy}>{busy ? t('composer.opening') : t('composer.start')}</button>
      </form>
      <div className="modelNotice"><i />{t('composer.modelNotice')}</div>
      <div className="skillStack"><span>{t('composer.skillStack')}</span><b>analyze-video</b><i>→</i><b>video-sherlock-visualize</b></div>
    </aside>
  )
}

function App() {
  const [locale, setLocale] = useState<UiLocale>(initialUiLocale)
  const t = useMemo(() => createTranslator(locale), [locale])
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [agentStatusKey, setAgentStatusKey] = useState<CopyKey>('status.skillReady')
  const [busy, setBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [toast, setToast] = useState('')
  const channelRef = useRef<BroadcastChannel | null>(null)
  const clientIdRef = useRef(createRequestId())
  const activeRequestRef = useRef('')

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return
    const channel = new BroadcastChannel(LOCALE_CHANNEL)
    const receive = (event: MessageEvent) => {
      const message = event.data as { source?: string; type?: string; locale?: unknown }
      if (message.source !== 'deepdeck-video-sherlock-client' || message.type !== 'locale') return
      const next = resolveUiLocale(message.locale)
      setLocale(next)
    }
    channel.addEventListener('message', receive)
    channel.postMessage({ source: 'deepdeck-video-sherlock-app', type: 'locale-request' })
    return () => channel.close()
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3200)
  }, [])

  const loadReports = useCallback(async (chooseNewest = false) => {
    try {
      const response = await fetch(`${API}/reports`, { cache: 'no-store' })
      const value = await response.json() as { reports?: ReportSummary[]; error?: string }
      if (!response.ok) throw new Error(value.error || t('error.readReports'))
      const next = Array.isArray(value.reports) ? value.reports : []
      setReports(current => {
        const persistedIds = new Set(next.map(item => item.id))
        const pending = current.filter(item => item.pending && !persistedIds.has(item.id))
        return [...pending, ...next]
      })
      if (chooseNewest && next[0]) setSelectedId(current => current || next[0].id)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }, [notify, t])

  const selectedSummary = useMemo(() => reports.find(item => item.id === selectedId), [reports, selectedId])

  useEffect(() => {
    if (!selectedId || !selectedSummary) { setReport(null); setLoading(false); return }
    if (selectedSummary.pending) {
      setReport({ ...selectedSummary, markdown: '', visualization: null })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetch(`${API}/reports?id=${encodeURIComponent(selectedId)}`, { cache: 'no-store' })
      .then(async response => {
        const value = await response.json() as ReportDetail & { error?: string }
        if (!response.ok) throw new Error(value.error || t('error.readReports'))
        if (!cancelled) setReport(value)
      })
      .catch(error => { if (!cancelled) notify(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedId, selectedSummary?.pending, selectedSummary?.updatedAt, selectedSummary?.visualized, notify, t])

  useEffect(() => {
    void loadReports(true)
    const poller = window.setInterval(() => void loadReports(false), 5000)
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(CHANNEL)
      channelRef.current = channel
      channel.addEventListener('message', event => {
        const message = event.data as AgentMessage
        if (message.source !== 'deepdeck-app-runtime' || message.type !== 'preview-state' || message.targetClientId !== clientIdRef.current || message.appId !== APP_ID || message.requestId !== activeRequestRef.current) return
        if (message.status === 'preparing') setAgentStatusKey('status.preparingSkill')
        if (message.status === 'running') { setAgentStatusKey('status.investigationActive'); setBusy(false) }
        if (message.status === 'completed') { setAgentStatusKey('status.dashboardReady'); setBusy(false); notify(t('toast.completed')); void loadReports(true) }
        if (message.status === 'failed' || message.status === 'cancelled') {
          setAgentStatusKey(message.status === 'failed' ? 'status.agentFailed' : 'status.agentCancelled')
          setBusy(false)
          notify(message.error || t('toast.notCompleted'))
        }
      })
    }
    return () => { window.clearInterval(poller); channelRef.current?.close() }
  }, [loadReports, notify, t])

  const deleteAnalysis = async (item: ReportSummary) => {
    if (item.pending || deletingId) return
    if (!window.confirm(t('delete.confirm', { title: item.title || item.id }))) return
    setDeletingId(item.id)
    try {
      const response = await fetch(`${API}/reports?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      const value = await response.json() as { deleted?: string; error?: string }
      if (!response.ok || value.deleted !== item.id) throw new Error(value.error || t('error.deleteReport'))
      const remaining = reports.filter(reportItem => reportItem.id !== item.id)
      setReports(remaining)
      if (selectedId === item.id) {
        setSelectedId(remaining[0]?.id || '')
        setReport(null)
      }
      notify(t('toast.deleted'))
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingId('')
    }
  }

  const startAnalysis = async (payload: Record<string, unknown>) => {
    const channel = channelRef.current
    if (!channel) { notify(t('error.channelUnsupported')); return }
    setBusy(true)
    setAgentStatusKey('status.injectingSkills')
    try {
      const prepareResponse = await fetch(`${API}/prepare`, { method: 'POST' })
      const prepared = await prepareResponse.json() as { ready?: boolean; error?: string }
      if (!prepareResponse.ok || prepared.ready !== true) throw new Error(prepared.error || t('error.prepareSkills'))
      const analysisId = createCaseId()
      const requestId = createRequestId()
      activeRequestRef.current = requestId
      setAgentStatusKey('status.openingAgent')
      const optimistic: ReportSummary = { id: analysisId, title: t('case.newInvestigation'), source: String(payload.source || ''), summary: '', status: 'processing', updatedAt: new Date().toISOString(), pending: true }
      setSelectedId(analysisId)
      setReport({ ...optimistic, markdown: '', visualization: null })
      setReports(current => [optimistic, ...current])
      channel.postMessage({ source: 'deepdeck-app-page', type: 'invoke', clientId: clientIdRef.current, requestId, appId: APP_ID, actionId: 'analyze', payload: { ...payload, analysisId, uiLocale: locale }, openSession: true })
      notify(t('toast.skillsInjected'))
    } catch (error) {
      setBusy(false)
      setAgentStatusKey('status.injectionFailed')
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <I18nContext.Provider value={{ locale, t }}>
    <div className="appShell">
      <aside className="caseRail">
        <div className="brand"><BrandMark /><div><b>Video Sherlock</b><small>{t('brand.console')}</small></div></div>
        <div className="railHeading"><span>{t('rail.caseFiles')}</span><button className="railRefresh" onClick={() => void loadReports(false)} aria-label={t('rail.refresh')}><RefreshIcon /></button></div>
        <nav className="caseList">
          {!reports.length && <p className="noCases">{t('rail.empty')}</p>}
          {reports.map(item => <div className={`caseRow ${selectedId === item.id ? 'active' : ''}`} key={item.id}><button type="button" className="caseSelect" onClick={() => setSelectedId(item.id)}><b>{item.title || item.id}</b><span><i className={item.status} />{item.visualized ? t('case.visualizationReady') : item.status === 'complete' ? t('case.reportReady') : t('case.analyzing')} · {formatDate(item.updatedAt, locale === 'zh' ? 'zh-CN' : 'en-US')}</span></button><button type="button" className="caseDelete" disabled={item.pending || deletingId === item.id} onClick={() => void deleteAnalysis(item)} aria-label={t('delete.action', { title: item.title || item.id })} title={item.pending ? t('delete.pendingDisabled') : t('delete.action', { title: item.title || item.id })}>{deletingId === item.id ? <span className="deleteSpinner" /> : <TrashIcon />}</button></div>)}
        </nav>
        <footer>{t('rail.footer')}<br />{t('rail.footerDetail')}</footer>
      </aside>
      <main className="mainStage">
        <header className="topBar"><span>{t('workspace.label')} / <b>{selectedId || t('workspace.overview')}</b></span><div className="topActions"><em>{t(agentStatusKey)}</em><button type="button" onClick={() => setComposerOpen(true)}>＋ {t('action.newInvestigation')}</button></div></header>
        <div className="stageScroll"><CaseReader report={report} loading={loading} onCreate={() => setComposerOpen(true)} /></div>
      </main>
      <button type="button" className={`composerBackdrop ${composerOpen ? 'open' : ''}`} onClick={() => setComposerOpen(false)} aria-label={t('action.closeComposer')} />
      <Composer onSubmit={startAnalysis} busy={busy} open={composerOpen} onClose={() => setComposerOpen(false)} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
    </I18nContext.Provider>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Video Sherlock root element is missing')
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>)
