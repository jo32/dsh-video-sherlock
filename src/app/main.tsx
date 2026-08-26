import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './player.css'
import './layout-fix.css'
import './vercel.css'

const APP_ID = 'video-sherlock-app'
const API = '/api/apps/video-sherlock-app'
const CHANNEL = 'deepdeck-app-conversations-v1'

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

type ReportDetail = ReportSummary & {
  markdown: string
  visualization: Visualization | null
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

function BrandMark() {
  return <div className="brandMark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.5" /><path d="m14.6 14.6 5.15 5.15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="m8.75 7.5 3.75 2.5-3.75 2.5v-5Z" fill="currentColor" /></svg></div>
}

function EmptyStage() {
  return (
    <section className="emptyStage">
      <div className="scanMark"><span /></div>
      <div className="eyebrow">Local-first evidence intelligence</div>
      <h1>Turn footage<br />into evidence.</h1>
      <p>提交视频链接或本地路径。Agent 会组合 <b>analyze-video</b> 与 <b>video-sherlock-visualize</b>，生成可审计报告和交互式证据面板。</p>
      <div className="pipeline">
        {[
          ['01', 'Acquire', '元数据与字幕'],
          ['02', 'Listen', '本地语音识别'],
          ['03', 'Inspect', '语义检索与关键帧'],
          ['04', 'Visualize', '时间轴与证据墙'],
        ].map(([index, title, copy]) => <div className="pipelineStep" key={index}><span>{index}</span><b>{title}</b><small>{copy}</small></div>)}
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

function EvidencePlayer({ visualization, caseId, videoPath, videoRef, currentTime, onTimeChange, onSeek, zh }: {
  visualization: Visualization
  caseId: string
  videoPath: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  currentTime: number
  onTimeChange: (time: number) => void
  onSeek: (time: number, autoplay?: boolean, reveal?: boolean) => void
  zh: boolean
}) {
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
    <section className="evidencePlayer" aria-label="Interactive evidence player">
      <div className="playerHeading"><div><span className="liveDot" />{zh ? '证据播放' : 'EVIDENCE PLAYBACK'}</div><p>{zh ? '拖动时间轴或点击高光点，播放器与证据自动同步' : 'Drag the timeline or select a highlight to synchronize evidence.'}</p></div>
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
          <div className="timeReadout"><strong>{formatTime(currentTime)}</strong><span>/ {formatTime(duration)}</span></div>
        </div>
        <aside className="nowPanel">
          <span className="nowLabel">{zh ? '当前调查节点' : 'NOW IN THE INVESTIGATION'}</span>
          <strong>{activeTopic?.topic || (zh ? '浏览证据时间线' : 'Browse the evidence timeline')}</strong>
          <p>{activeTopic?.evidence || (zh ? '播放视频或选择下方主题，查看此刻对应的论点与视觉证据。' : 'Play the video or select a topic to inspect the synchronized argument and visual evidence.')}</p>
          {activeFrame && <button className="activeEvidence" onClick={() => onSeek(activeFrame.timestamp_seconds, false, false)}>
            <img src={artifactUrl(caseId, activeFrame.path)} alt="Nearest inspected evidence" />
            <span><small>{zh ? '最近检查帧' : 'NEAREST INSPECTED FRAME'} · {formatTime(activeFrame.timestamp_seconds)}</small><b>{activeFrame.observation}</b></span>
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
          <input aria-label={zh ? '视频时间轴' : 'Video timeline'} type="range" min={0} max={duration} step={0.1} value={Math.min(duration, currentTime)} onChange={event => onSeek(Number(event.target.value), false, false)} />
          <div className="evidenceMarkers">
            {visualization.frames.map(frame => <button key={frame.id} className={activeFrame?.id === frame.id ? 'active' : ''} style={{ left: `${Math.max(0, Math.min(100, frame.timestamp_seconds / duration * 100))}%` }} title={`${formatTime(frame.timestamp_seconds)} · ${frame.query || frame.observation}`} aria-label={zh ? `跳转到 ${formatTime(frame.timestamp_seconds)} 高光证据` : `Jump to evidence highlight at ${formatTime(frame.timestamp_seconds)}`} onClick={() => onSeek(frame.timestamp_seconds, true, false)}><span /></button>)}
          </div>
        </div>
        <div className="scrubberAxis"><span>00:00</span><b>{visualization.frames.length} {zh ? '个证据高光' : 'EVIDENCE HIGHLIGHTS'}</b><span>{formatTime(duration)}</span></div>
      </div>
      <div className="chapterStrip">
        {visualization.timeline.map(item => <button key={item.id} className={activeTopic?.id === item.id ? 'active' : ''} onClick={() => onSeek(item.start_seconds, false, false)}><span>{formatTime(item.start_seconds)}</span>{item.topic}</button>)}
      </div>
    </section>
  )
}

function DensityChart({ values, engine, zh }: { values: Visualization['transcript_density']; engine: string; zh: boolean }) {
  if (!values.length) return null
  return (
    <Panel title={zh ? '语音信号' : 'Speech signal'} detail={`${zh ? '转录密度' : 'Transcript density'} · ${engine || 'unknown'}`}>
      <div className="densityChart">
        {values.map((item, index) => (
          <div className="densityBar" key={index} style={{ height: `${Math.max(5, item.intensity * 100)}%` }} title={`${formatTime(item.start_seconds)} · ${item.segments} segments`} />
        ))}
      </div>
      <div className="axis"><span>00:00</span><span>{zh ? '转录活跃度' : 'TRANSCRIPT ACTIVITY'}</span><span>{formatTime(values.at(-1)?.start_seconds ?? 0)}</span></div>
    </Panel>
  )
}

function NarrativeMap({ timeline, duration, currentTime, onSeek, zh }: { timeline: TimelineItem[]; duration: number; currentTime: number; onSeek: (time: number) => void; zh: boolean }) {
  if (!timeline.length) return null
  const safeDuration = Math.max(1, duration)
  return (
    <Panel title={zh ? '叙事地图' : 'Narrative map'} detail={zh ? '点击主题跳转到原视频' : 'Select a topic to jump to the source video'}>
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

function EvidenceWall({ frames, caseId, currentTime, onSeek, zh }: { frames: EvidenceFrame[]; caseId: string; currentTime: number; onSeek: (time: number, autoplay?: boolean) => void; zh: boolean }) {
  if (!frames.length) return null
  return (
    <Panel title={zh ? '视觉证据' : 'Visual evidence'} detail={zh ? `${frames.length} 个已检查关键帧 · 点击回看` : `${frames.length} inspected keyframes · Select to review`} className="evidencePanel">
      <div className="evidenceWall">
        {frames.map((frame) => (
          <article className={`evidenceCard ${Math.abs(frame.timestamp_seconds - currentTime) <= 18 ? 'active' : ''}`} key={frame.id} role="button" tabIndex={0} onClick={() => onSeek(frame.timestamp_seconds, true)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSeek(frame.timestamp_seconds, true) } }}>
            <div className="frameImage">
              <img src={artifactUrl(caseId, frame.path)} loading="lazy" alt={frame.observation || 'Video evidence frame'} />
              <span>▶ {formatTime(frame.timestamp_seconds)}</span>
            </div>
            <div className="frameCopy">
              <b>{frame.query || frame.source || 'Selected evidence'}</b>
              <p>{frame.observation || frame.relevance || 'Awaiting visual observation'}</p>
              <footer><em className={`confidence ${frame.confidence}`}>{frame.confidence || 'unknown'}</em><span>{frame.source}</span></footer>
            </div>
          </article>
        ))}
      </div>
    </Panel>
  )
}

function EvidenceDashboard({ visualization, caseId, videoPath }: { visualization: Visualization; caseId: string; videoPath?: string }) {
  const zh = caseId.endsWith('-zh')
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
      {visualization.summary && <div className="summaryCallout"><span>{zh ? '执行摘要' : 'Executive synthesis'}</span><p>{visualization.summary}</p></div>}
      {videoPath && <div ref={playerRef}><EvidencePlayer visualization={visualization} caseId={caseId} videoPath={videoPath} videoRef={videoRef} currentTime={currentTime} onTimeChange={setCurrentTime} onSeek={seek} zh={zh} /></div>}
      {!videoPath && <div className="videoUnavailable">{zh ? '原始视频未在案件目录内，时间轴仍可浏览，但无法直接播放。' : 'The source video is unavailable in this case. The evidence timeline remains browsable.'}</div>}
      <div className="metrics">
        <Metric value={formatTime(visualization.duration_seconds)} label={zh ? '时长' : 'Duration'} tone={0} />
        <Metric value={Number(metrics.transcript_segments || 0).toLocaleString()} label={zh ? '转录片段' : 'Transcript segments'} tone={35} />
        <Metric value={Number(metrics.inspected_frames || 0).toLocaleString()} label={zh ? '检查帧' : 'Inspected frames'} tone={70} />
        <Metric value={Number(metrics.timeline_sections || 0).toLocaleString()} label={zh ? '主题章节' : 'Topic sections'} tone={105} />
      </div>
      <DensityChart values={visualization.transcript_density ?? []} engine={visualization.transcript_engine} zh={zh} />
      <NarrativeMap timeline={visualization.timeline ?? []} duration={visualization.duration_seconds} currentTime={currentTime} onSeek={seek} zh={zh} />
      {!!visualization.topics?.length && <Panel title={zh ? '语义索引' : 'Semantic index'} detail={zh ? `${visualization.topics.length} 个检测主题` : `${visualization.topics.length} detected topics`}><div className="topicChips">{visualization.topics.map(topic => <span key={topic}>{topic}</span>)}</div></Panel>}
      <EvidenceWall frames={visualization.frames ?? []} caseId={caseId} currentTime={currentTime} onSeek={seek} zh={zh} />
      {!!visualization.limitations?.length && <Panel title={zh ? '局限性记录' : 'Limitations ledger'} detail={zh ? '已知缺口与不确定性' : 'Known gaps and uncertainty'}><ul className="limitations">{visualization.limitations.map(item => <li key={item}>{item}</li>)}</ul></Panel>}
    </div>
  )
}

function ReportDocument({ markdown, caseId }: { markdown: string; caseId: string }) {
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
  const zh = caseId.endsWith('-zh')
  return <details className="reportDocument"><summary>{zh ? '完整审计报告' : 'Full audit report'} <span>report.md</span></summary><article>{blocks}</article></details>
}

function CaseReader({ report, loading }: { report: ReportDetail | null; loading: boolean }) {
  if (loading) return <div className="loadingStage"><div className="scanMark"><span /></div><p>Loading evidence graph…</p></div>
  if (!report) return <EmptyStage />
  const visualization = normalizeVisualization(report.visualization)
  const zh = report.id.endsWith('-zh')
  return (
    <div className="caseReader">
      <header className="caseHeader">
        <div className="eyebrow">{report.status === 'complete' ? (zh ? '已验证案件' : 'Verified case file') : (zh ? '调查进行中' : 'Investigation in progress')}</div>
        <h1>{report.title}</h1>
        <p>{report.source || 'Local video investigation'}</p>
      </header>
      {visualization ? <EvidenceDashboard visualization={visualization} caseId={report.id} videoPath={report.videoPath} /> : (
        <div className="pendingCard"><div className="scanMark small"><span /></div><div><b>Agent 正在构建证据图谱</b><p>字幕密度、主题时间轴与关键帧证据墙会随 visualization.json 自动出现。</p></div></div>
      )}
      <ReportDocument markdown={report.markdown} caseId={report.id} />
    </div>
  )
}

function Composer({ onSubmit, busy, open, onClose }: { onSubmit: (payload: Record<string, unknown>) => void | Promise<void>; busy: boolean; open: boolean; onClose: () => void }) {
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
      <div className="composerTop"><div className="eyebrow">New investigation</div><button type="button" className="composerClose" onClick={onClose} aria-label="关闭新建调查面板">×</button></div>
      <h2>分析一个视频</h2>
      <p className="composerIntro">Agent 会调用两个注入的 skill，把取证产物直接映射为本页面的数据可视化。</p>
      <form onSubmit={submit}>
        <label><span><b>视频来源</b><em>URL 或本地绝对路径</em></span><input required maxLength={4000} value={source} onChange={event => setSource(event.target.value)} placeholder="https://… 或 /Users/…/video.mp4" /></label>
        <label><span><b>调查重点</b><em>可选</em></span><textarea maxLength={4000} value={focus} onChange={event => setFocus(event.target.value)} placeholder="核心论点、图表证据、产品演示、局限……" /></label>
        <label><span><b>内容语言</b></span><select value={language} onChange={event => setLanguage(event.target.value)}><option value="auto">自动检测</option><option value="zh">中文 / 粤语优先</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
        <div className="toggles"><label><input type="checkbox" checked={metadataOnly} onChange={event => setMetadataOnly(event.target.checked)} />先做轻量勘察</label><label><input type="checkbox" checked={noModelFetch} onChange={event => setNoModelFetch(event.target.checked)} />仅用缓存模型</label></div>
        <button className="analyzeButton" disabled={busy}>{busy ? 'Opening Agent…' : '开始证据分析 →'}</button>
      </form>
      <div className="modelNotice"><i />首次完整分析可能按需下载 vq、FFmpeg 相关工具或阶段模型。有可用字幕时不会下载 ASR 模型。</div>
      <div className="skillStack"><span>SKILL STACK</span><b>analyze-video</b><i>→</i><b>video-sherlock-visualize</b></div>
    </aside>
  )
}

function App() {
  const [reports, setReports] = useState<ReportSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [agentStatus, setAgentStatus] = useState('Skill ready')
  const [busy, setBusy] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const [toast, setToast] = useState('')
  const channelRef = useRef<BroadcastChannel | null>(null)
  const clientIdRef = useRef(createRequestId())
  const activeRequestRef = useRef('')

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3200)
  }, [])

  const loadReports = useCallback(async (chooseNewest = false) => {
    try {
      const response = await fetch(`${API}/reports`, { cache: 'no-store' })
      const value = await response.json() as { reports?: ReportSummary[]; error?: string }
      if (!response.ok) throw new Error(value.error || '无法读取报告')
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
  }, [notify])

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
        if (!response.ok) throw new Error(value.error || '无法读取报告')
        if (!cancelled) setReport(value)
      })
      .catch(error => { if (!cancelled) notify(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedId, selectedSummary?.pending, selectedSummary?.updatedAt, selectedSummary?.visualized, notify])

  useEffect(() => {
    void loadReports(true)
    const poller = window.setInterval(() => void loadReports(false), 5000)
    if (typeof BroadcastChannel === 'function') {
      const channel = new BroadcastChannel(CHANNEL)
      channelRef.current = channel
      channel.addEventListener('message', event => {
        const message = event.data as AgentMessage
        if (message.source !== 'deepdeck-app-runtime' || message.type !== 'preview-state' || message.targetClientId !== clientIdRef.current || message.appId !== APP_ID || message.requestId !== activeRequestRef.current) return
        if (message.status === 'preparing') setAgentStatus('Preparing skill…')
        if (message.status === 'running') { setAgentStatus('Agent investigation active'); setBusy(false) }
        if (message.status === 'completed') { setAgentStatus('Evidence dashboard ready'); setBusy(false); notify('Agent 已完成，正在刷新证据面板。'); void loadReports(true) }
        if (message.status === 'failed' || message.status === 'cancelled') { setAgentStatus(`Agent ${message.status}`); setBusy(false); notify(message.error || 'Agent 任务未完成。') }
      })
    }
    return () => { window.clearInterval(poller); channelRef.current?.close() }
  }, [loadReports, notify])

  const startAnalysis = async (payload: Record<string, unknown>) => {
    const channel = channelRef.current
    if (!channel) { notify('当前浏览器不支持 App Agent 会话。'); return }
    setBusy(true)
    setAgentStatus('Injecting skills…')
    try {
      const prepareResponse = await fetch(`${API}/prepare`, { method: 'POST' })
      const prepared = await prepareResponse.json() as { ready?: boolean; error?: string }
      if (!prepareResponse.ok || prepared.ready !== true) throw new Error(prepared.error || '无法准备 App skills')
      const analysisId = createCaseId()
      const requestId = createRequestId()
      activeRequestRef.current = requestId
      setAgentStatus('Opening Agent…')
      const optimistic: ReportSummary = { id: analysisId, title: 'New investigation', source: String(payload.source || ''), summary: '', status: 'processing', updatedAt: new Date().toISOString(), pending: true }
      setSelectedId(analysisId)
      setReport({ ...optimistic, markdown: '', visualization: null })
      setReports(current => [optimistic, ...current])
      channel.postMessage({ source: 'deepdeck-app-page', type: 'invoke', clientId: clientIdRef.current, requestId, appId: APP_ID, actionId: 'analyze', payload: { ...payload, analysisId }, openSession: true })
      notify('Skills 已注入，正在打开 Agent 调查。')
    } catch (error) {
      setBusy(false)
      setAgentStatus('Skill injection failed')
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="appShell">
      <aside className="caseRail">
        <div className="brand"><BrandMark /><div><b>Video Sherlock</b><small>Evidence console</small></div></div>
        <div className="railHeading"><span>Case files</span><button onClick={() => void loadReports(false)} aria-label="刷新案件">↻</button></div>
        <nav className="caseList">
          {!reports.length && <p className="noCases">还没有案件。提交第一个视频开始分析。</p>}
          {reports.map(item => { const zh = item.id.endsWith('-zh'); return <button className={selectedId === item.id ? 'active' : ''} key={item.id} onClick={() => setSelectedId(item.id)}><b>{item.title || item.id}</b><span><i className={item.status} />{item.visualized ? (zh ? '可视化完成' : 'Visualization ready') : item.status === 'complete' ? (zh ? '报告完成' : 'Report ready') : (zh ? '分析中' : 'Analyzing')} · {formatDate(item.updatedAt, zh ? 'zh-CN' : 'en-US')}</span></button> })}
        </nav>
        <footer>LOCAL-FIRST VIDEO INTELLIGENCE<br />字幕 · ASR · 语义帧检索 · 证据报告</footer>
      </aside>
      <main className="mainStage">
        <header className="topBar"><span>Workspace / <b>{selectedId || 'Overview'}</b></span><div className="topActions"><em>{agentStatus}</em><button type="button" onClick={() => setComposerOpen(true)}>＋ 新建调查</button></div></header>
        <div className="stageScroll"><CaseReader report={report} loading={loading} /></div>
      </main>
      <button type="button" className={`composerBackdrop ${composerOpen ? 'open' : ''}`} onClick={() => setComposerOpen(false)} aria-label="关闭新建调查面板" />
      <Composer onSubmit={startAnalysis} busy={busy} open={composerOpen} onClose={() => setComposerOpen(false)} />
      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Video Sherlock root element is missing')
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>)
