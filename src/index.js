import { createReadStream } from 'node:fs'
import { cp, mkdir, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ID = 'video-sherlock-app'
const APP_TITLE = 'Video Sherlock'
const PACKAGE_NAME = '@deepdeck-apps/video-sherlock-app'
const PAGE_PATH = '/apps/video-sherlock-app'
const APP_JS_PATH = PAGE_PATH + '/app.js'
const APP_CSS_PATH = PAGE_PATH + '/app.css'
const API_PATH = '/api/apps/video-sherlock-app'
const OPEN_PATH = API_PATH + '/open'
const PREPARE_PATH = API_PATH + '/prepare'
const REPORTS_PATH = API_PATH + '/reports'
const ARTIFACT_PATH = API_PATH + '/artifact'
const MAX_TEXT_BYTES = 8 * 1024 * 1024
const BUNDLED_SKILLS = ['analyze-video', 'video-sherlock-visualize']

function pageHtml(locale) {
  const documentLanguage = locale === 'zh' ? 'zh-CN' : 'en'
  return `<!doctype html>
<html lang="${documentLanguage}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07090c">
  <title>Video Sherlock</title>
  <link rel="stylesheet" href="${APP_CSS_PATH}">
</head>
<body>
  <div id="root"></div>
  <script src="${APP_JS_PATH}" defer></script>
</body>
</html>`
}

export const inject = ['appConversations', 'webServer']

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

function sendBuffer(response, contentType, body, cacheControl = 'no-store') {
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

function streamMedia(request, response, path, contentType, size) {
  const range = request.headers.range
  if (typeof range === 'string') {
    const match = range.match(/^bytes=(\d*)-(\d*)$/)
    if (!match) { response.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return }
    const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0
    const start = suffixLength ? Math.max(0, size - suffixLength) : (match[1] ? Number(match[1]) : 0)
    const requestedEnd = suffixLength ? size - 1 : (match[2] ? Number(match[2]) : size - 1)
    const end = Math.min(requestedEnd, size - 1)
    if ((!match[1] && !suffixLength) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
      response.writeHead(416, { 'content-range': `bytes */${size}` }).end()
      return
    }
    response.writeHead(206, {
      'content-type': contentType,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=60',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') response.end()
    else createReadStream(path, { start, end }).pipe(response)
    return
  }
  response.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=60',
    'x-content-type-options': 'nosniff',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(path).pipe(response)
}

function sameOrigin(request) {
  const host = request.headers.host
  const origin = request.headers.origin
  if (typeof host !== 'string' || typeof origin !== 'string') return false
  try {
    const value = new URL(origin)
    return (value.protocol === 'http:' || value.protocol === 'https:') && value.host === host
  } catch {
    return false
  }
}

function safeAnalysisId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value) ? value : ''
}

function safeUiLocale(value) {
  if (typeof value !== 'string') return ''
  const primary = value.trim().toLowerCase().split('-')[0]
  return primary === 'zh' || primary === 'en' ? primary : ''
}

function requestUiLocale(request, url) {
  const explicit = safeUiLocale(url.searchParams.get('locale'))
  if (explicit) return explicit
  const requested = typeof request.headers['accept-language'] === 'string' ? request.headers['accept-language'].split(',') : []
  for (const entry of requested) {
    const locale = safeUiLocale(entry.split(';')[0])
    if (locale) return locale
  }
  return 'en'
}

async function readJsonFile(path, fallback = {}) {
  try {
    const text = await readFile(path, 'utf8')
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) return fallback
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

async function optionalStat(path) {
  try { return await stat(path) } catch { return null }
}

function latestUpdatedAt(...stats) {
  return new Date(Math.max(...stats.filter(Boolean).map(value => value.mtimeMs))).toISOString()
}

function reportTitle(manifest, metadata, fallback) {
  if (typeof manifest.display_title === 'string' && manifest.display_title.trim()) return manifest.display_title.trim()
  if (typeof metadata.title === 'string' && metadata.title.trim()) return metadata.title.trim()
  return fallback
}

async function reportSummary(analysesRoot, entry) {
  const directory = join(analysesRoot, entry.name)
  const [directoryStats, manifest, metadata, analysis, visualization, reportStats, visualizationStats] = await Promise.all([
    stat(directory),
    readJsonFile(join(directory, 'manifest.json')),
    readJsonFile(join(directory, 'raw', 'metadata.json')),
    readJsonFile(join(directory, 'raw', 'analysis.json')),
    readJsonFile(join(directory, 'visualization.json'), null),
    optionalStat(join(directory, 'report.md')),
    optionalStat(join(directory, 'visualization.json')),
  ])
  return {
    id: entry.name,
    title: reportTitle(manifest, metadata, entry.name),
    source: typeof metadata.source_url === 'string' ? metadata.source_url : (typeof manifest.requested_source === 'string' ? manifest.requested_source : ''),
    summary: typeof analysis.summary === 'string' ? analysis.summary : '',
    status: reportStats ? 'complete' : 'processing',
    updatedAt: latestUpdatedAt(directoryStats, reportStats, visualizationStats),
    visualized: visualization?.schema_version === 1,
  }
}

async function listReports(analysesRoot) {
  let entries
  try { entries = await readdir(analysesRoot, { withFileTypes: true }) } catch { return [] }
  const reports = await Promise.all(
    entries
      .filter(entry => entry.isDirectory() && safeAnalysisId(entry.name))
      .map(entry => reportSummary(analysesRoot, entry).catch(() => null)),
  )
  return reports.filter(Boolean).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

async function videoArtifactPath(directory, manifest) {
  if (typeof manifest.video !== 'string' || !manifest.video.trim()) return ''
  try {
    const root = await realpath(directory)
    const candidate = await realpath(resolve(manifest.video))
    if (!candidate.startsWith(root + sep)) return ''
    const extension = extname(candidate).toLowerCase()
    if (!['.mp4', '.mov', '.webm', '.mkv'].includes(extension)) return ''
    const stats = await stat(candidate)
    return stats.isFile() ? candidate.slice(root.length + 1).split(sep).join('/') : ''
  } catch {
    return ''
  }
}

function reportTranscript(value) {
  const segments = Array.isArray(value?.segments) ? value.segments : []
  return {
    engine: typeof value?.engine === 'string' ? value.engine.slice(0, 80) : 'none',
    language: typeof value?.language === 'string' ? value.language.slice(0, 80) : 'unknown',
    segments: segments.slice(0, 50000).flatMap(segment => {
      if (!segment || typeof segment !== 'object') return []
      const start = Number(segment.start_seconds)
      const end = Number(segment.end_seconds)
      const text = typeof segment.text === 'string' ? segment.text.trim().slice(0, 4000) : ''
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || !text) return []
      return [{ start_seconds: start, end_seconds: end, text }]
    }),
  }
}

async function getReport(analysesRoot, id) {
  const directory = join(analysesRoot, id)
  const directoryStats = await stat(directory)
  if (!directoryStats.isDirectory()) throw new Error('report not found')
  const [manifest, metadata, analysis, visualization, transcript] = await Promise.all([
    readJsonFile(join(directory, 'manifest.json')),
    readJsonFile(join(directory, 'raw', 'metadata.json')),
    readJsonFile(join(directory, 'raw', 'analysis.json')),
    readJsonFile(join(directory, 'visualization.json'), null),
    readJsonFile(join(directory, 'raw', 'transcript.json')),
  ])
  let markdown = ''
  let reportStats
  try {
    reportStats = await stat(join(directory, 'report.md'))
    if (reportStats.size <= MAX_TEXT_BYTES) markdown = await readFile(join(directory, 'report.md'), 'utf8')
  } catch { reportStats = null }
  const [videoPath, visualizationStats] = await Promise.all([
    videoArtifactPath(directory, manifest),
    optionalStat(join(directory, 'visualization.json')),
  ])
  return {
    id,
    title: reportTitle(manifest, metadata, id),
    source: typeof metadata.source_url === 'string' ? metadata.source_url : (typeof manifest.requested_source === 'string' ? manifest.requested_source : ''),
    summary: typeof analysis.summary === 'string' ? analysis.summary : '',
    status: reportStats ? 'complete' : 'processing',
    updatedAt: latestUpdatedAt(directoryStats, reportStats, visualizationStats),
    markdown,
    visualization,
    transcript: reportTranscript(transcript),
    videoPath,
  }
}

const MIME_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mkv', 'video/x-matroska'],
])

export function apply(ctx) {
  const conversations = ctx.get('appConversations')
  const webServer = ctx.get('webServer')
  if (conversations === undefined || webServer === undefined) throw new Error(APP_TITLE + ' requires the DeepDeck Apps runtime')
  const sourcePackageRoot = fileURLToPath(new URL('..', import.meta.url))
  const assetRoot = fileURLToPath(new URL('.', import.meta.url))
  const workspaceRoot = join(homedir(), 'DeepDeck', 'Apps', APP_ID)
  const analysesRoot = join(workspaceRoot, 'video-analyses')
  const bundledSkillsRoot = join(sourcePackageRoot, '.agents', 'skills')

  async function syncWorkspaceSkills() {
    const workspaceSkillsRoot = join(workspaceRoot, '.agents', 'skills')
    await mkdir(workspaceSkillsRoot, { recursive: true })
    await Promise.all(BUNDLED_SKILLS.map(skillName => cp(
      join(bundledSkillsRoot, skillName),
      join(workspaceSkillsRoot, skillName),
      { recursive: true, force: true },
    )))
  }

  void syncWorkspaceSkills().catch(() => {})

  ctx.effect(() => conversations.register({
    id: APP_ID,
    title: APP_TITLE,
    workspaceSlug: APP_ID,
    workspaceTitle: 'Apps · ' + APP_TITLE,
    packageName: PACKAGE_NAME,
    sourcePackageRoot,
    appWindowPath: PAGE_PATH,
  }), APP_ID + ': App registration')

  ctx.effect(() => webServer.register({
    kind: 'exact', path: PAGE_PATH,
    async handler(request, response) {
      if (request.method !== 'GET') { response.writeHead(405).end(); return }
      const url = new URL(request.url || PAGE_PATH, 'http://local')
      const body = Buffer.from(pageHtml(requestUiLocale(request, url)))
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
    },
  }), APP_ID + ': React shell')

  for (const [path, fileName, contentType] of [
    [APP_JS_PATH, 'app.js', 'text/javascript; charset=utf-8'],
    [APP_CSS_PATH, 'app.css', 'text/css; charset=utf-8'],
  ]) {
    ctx.effect(() => webServer.register({
      kind: 'exact', path,
      async handler(request, response) {
        if (request.method !== 'GET') { response.writeHead(405).end(); return }
        try { sendBuffer(response, contentType, await readFile(join(assetRoot, fileName)), 'no-store') }
        catch { response.writeHead(404).end() }
      },
    }), APP_ID + ': ' + fileName)
  }

  ctx.effect(() => webServer.register({
    kind: 'exact', path: OPEN_PATH,
    async handler(request, response) {
      if (request.method !== 'POST' || !sameOrigin(request)) { sendJson(response, 403, { error: 'same-origin POST required' }); return }
      const url = new URL(request.url || OPEN_PATH, 'http://local')
      const pageUrl = new URL(PAGE_PATH, request.headers.origin)
      pageUrl.searchParams.set('locale', requestUiLocale(request, url))
      const href = pageUrl.href
      const opened = typeof process.send === 'function' ? process.send({ type: 'deepdeck:open-app-window', url: href }) : false
      sendJson(response, 200, { opened, url: href })
    },
  }), APP_ID + ': App window bridge')

  ctx.effect(() => webServer.register({
    kind: 'exact', path: PREPARE_PATH,
    async handler(request, response) {
      if (request.method !== 'POST' || !sameOrigin(request)) { sendJson(response, 403, { error: 'same-origin POST required' }); return }
      try {
        await syncWorkspaceSkills()
        sendJson(response, 200, { ready: true, skills: BUNDLED_SKILLS })
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), APP_ID + ': Workspace skill preparation')

  ctx.effect(() => webServer.register({
    kind: 'exact', path: REPORTS_PATH,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'DELETE') { response.writeHead(405).end(); return }
      try {
        const url = new URL(request.url || REPORTS_PATH, 'http://local')
        const id = safeAnalysisId(url.searchParams.get('id'))
        if (url.searchParams.has('id') && !id) { sendJson(response, 400, { error: 'invalid report id' }); return }
        if (request.method === 'DELETE') {
          if (!sameOrigin(request)) { sendJson(response, 403, { error: 'same-origin DELETE required' }); return }
          if (!id) { sendJson(response, 400, { error: 'report id required' }); return }
          const root = await realpath(analysesRoot)
          const reportDirectory = await realpath(join(analysesRoot, id))
          if (!reportDirectory.startsWith(root + sep)) throw new Error('report path escapes analyses root')
          const reportStats = await stat(reportDirectory)
          if (!reportStats.isDirectory()) throw new Error('report not found')
          await rm(join(analysesRoot, id), { recursive: true, force: false, maxRetries: 2 })
          sendJson(response, 200, { deleted: id })
          return
        }
        sendJson(response, 200, id ? await getReport(analysesRoot, id) : { reports: await listReports(analysesRoot) })
      } catch (error) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), APP_ID + ': Reports API')

  ctx.effect(() => webServer.register({
    kind: 'exact', path: ARTIFACT_PATH,
    async handler(request, response) {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return }
      try {
        const url = new URL(request.url || ARTIFACT_PATH, 'http://local')
        const id = safeAnalysisId(url.searchParams.get('id'))
        const relativePath = url.searchParams.get('path') || ''
        if (!id || !relativePath || relativePath.includes('\0')) throw new Error('invalid artifact path')
        const reportDirectory = await realpath(resolve(analysesRoot, id))
        const requestedPath = resolve(reportDirectory, relativePath)
        if (!requestedPath.startsWith(reportDirectory + sep)) throw new Error('artifact path escapes report')
        const artifactPath = await realpath(requestedPath)
        if (!artifactPath.startsWith(reportDirectory + sep)) throw new Error('artifact symlink escapes report')
        const extension = extname(artifactPath).toLowerCase()
        const mime = MIME_TYPES.get(extension)
        if (!mime) throw new Error('unsupported artifact type')
        const artifactStats = await stat(artifactPath)
        if (!artifactStats.isFile()) throw new Error('artifact unavailable')
        if (mime.startsWith('video/')) {
          streamMedia(request, response, artifactPath, mime, artifactStats.size)
          return
        }
        if (request.method === 'HEAD') {
          response.writeHead(200, { 'content-type': mime, 'content-length': artifactStats.size, 'cache-control': 'private, max-age=60', 'x-content-type-options': 'nosniff' }).end()
          return
        }
        if (artifactStats.size > 32 * 1024 * 1024) throw new Error('artifact unavailable')
        sendBuffer(response, mime, await readFile(artifactPath), 'private, max-age=60')
      } catch (error) {
        sendJson(response, 404, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), APP_ID + ': Artifact API')
}
