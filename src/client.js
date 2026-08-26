import { useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

const APP_ID = 'video-sherlock-app'
const APP_TITLE = 'Video Sherlock'
const OPEN_PATH = '/api/apps/video-sherlock-app/open'
const LOCALE_CHANNEL = 'deepdeck-video-sherlock-locale-v1'
const LOCALE_NS = 'video-sherlock-app'

const zh = {
  'app.title': APP_TITLE,
  'launcher.opening': `正在打开 ${APP_TITLE}…`,
  'settings.title': '视频证据工作区',
  'settings.description': '注入 analyze-video 与 video-sherlock-visualize，并将案件产物渲染为交互式证据面板。',
  'action.reconnaissance': '执行视频轻量勘察',
  'action.investigate': '调查视频',
}

const en = {
  'app.title': APP_TITLE,
  'launcher.opening': `Opening ${APP_TITLE}…`,
  'settings.title': 'Video evidence workspace',
  'settings.description': 'Injects analyze-video and video-sherlock-visualize, then renders their case artifacts as interactive evidence dashboards.',
  'action.reconnaissance': 'Run video reconnaissance',
  'action.investigate': 'Investigate video',
}

function normalizeUiLocale(value) {
  return value === 'zh' ? 'zh' : 'en'
}

function VideoSherlockIcon({ size = 18 }) {
  return jsx('svg', {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': true,
    children: [
      jsx('circle', { cx: 8.5, cy: 8.5, r: 5.25, stroke: 'currentColor', strokeWidth: 1.5 }),
      jsx('path', { d: 'M12.35 12.35 17 17', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      jsx('path', { d: 'm7.4 6.35 3.35 2.15-3.35 2.15V6.35Z', fill: 'currentColor' }),
    ],
  })
}

function Launcher({ wide = false, closeApps, readLocale, t }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (busy) return
    setBusy(true)
    try {
      const locale = normalizeUiLocale(readLocale?.())
      const response = await fetch(`${OPEN_PATH}?locale=${encodeURIComponent(locale)}`, { method: 'POST' })
      const value = await response.json()
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Unable to open App')
      if (value.opened !== true && typeof value.url === 'string') window.open(value.url, '_blank', 'noopener,noreferrer')
      closeApps?.()
    } finally {
      setBusy(false)
    }
  }
  const label = busy ? t('launcher.opening') : t('app.title')
  return jsx(Tooltip, {
    label: t('app.title'),
    delayMs: 500,
    disabled: wide,
    children: jsx(Button, {
      variant: 'ghost',
      disabled: busy,
      'data-deepdeck-app-launcher': APP_ID,
      'data-wide': wide,
      'aria-label': label,
      icon: jsx(VideoSherlockIcon, { size: wide ? 16 : 18 }),
      onClick: () => { void open() },
      children: wide ? label : null,
    }),
  })
}

function Settings({ t }) {
  return jsx('div', {
    style: { display: 'grid', gap: 4, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 },
    children: [
      jsx('strong', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 }, children: t('settings.title') }),
      jsx('span', { children: t('settings.description') }),
    ],
  })
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function prepareAnalyzeAction(value) {
  if (!isObject(value)) throw new Error('Video analysis payload must be an object')
  const analysisId = typeof value.analysisId === 'string' ? value.analysisId.trim() : ''
  const source = typeof value.source === 'string' ? value.source.trim().slice(0, 4000) : ''
  const focus = typeof value.focus === 'string' ? value.focus.trim().slice(0, 4000) : ''
  const language = ['auto', 'zh', 'en', 'ja', 'ko'].includes(value.language) ? value.language : 'auto'
  const metadataOnly = value.metadataOnly === true
  const noModelFetch = value.noModelFetch === true
  const uiLocale = normalizeUiLocale(value.uiLocale)
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(analysisId) || !source) throw new Error('A valid video source and case id are required')
  const outputDirectory = `./video-analyses/${analysisId}`
  const instructions = [
    'Use the video-sherlock-visualize skill to investigate the video below and produce the App visualization artifacts.',
    'That skill extends analyze-video: load and follow both skills exactly, preserving their evidence and auditability rules.',
    `Video source: ${source}`,
    `Required analysis directory: ${outputDirectory}`,
    `Language hint: ${language}`,
    `Run mode: ${metadataOnly ? 'metadata-only reconnaissance' : 'complete evidence analysis'}`,
    `Model policy: ${noModelFetch ? 'cached models only; pass --no-model-fetch' : 'allow lazy stage-specific model downloads'}`,
    focus ? `Investigation focus: ${focus}` : 'Investigation focus: comprehensive summary, key claims, visual evidence, timeline, and limitations.',
    '',
    'Do not modify the Video Sherlock App source code. Put every generated artifact only inside the required analysis directory.',
    'For metadata-only mode, pass --metadata-only to analyze-video preparation and still run build_visualization.py afterward.',
    'For a full run, finish report.md with strict assembly first, then generate and verify visualization.json.',
    'When done, report the absolute paths and a concise status summary. The App will detect and render the files automatically.',
  ]
  return {
    title: (uiLocale === 'zh' ? zh : en)[metadataOnly ? 'action.reconnaissance' : 'action.investigate'],
    sessionTitle: `[Video Sherlock] ${analysisId}`,
    prompt: instructions.join('\n'),
  }
}

export const inject = ['slots', 'appConversations', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), APP_ID + ': dictionaries')
  ctx.effect(() => {
    if (typeof BroadcastChannel !== 'function') return undefined
    const channel = new BroadcastChannel(LOCALE_CHANNEL)
    let published = ''
    const publish = () => {
      const locale = normalizeUiLocale(ctx.locale.getLocale().active)
      if (locale === published) return
      published = locale
      channel.postMessage({ source: 'deepdeck-video-sherlock-client', type: 'locale', locale })
    }
    const receive = (event) => {
      const message = event.data
      if (!isObject(message) || message.source !== 'deepdeck-video-sherlock-app' || message.type !== 'locale-request') return
      published = ''
      publish()
    }
    channel.addEventListener('message', receive)
    const unsubscribe = ctx.locale.subscribe(publish)
    publish()
    return () => {
      unsubscribe()
      channel.close()
    }
  }, APP_ID + ': locale bridge')
  ctx.slots.inject('sidebar.apps', () => ctx.slots.register({
    name: 'sidebar.apps',
    id: APP_ID,
    order: 20,
    label: () => ctx.locale.bind(LOCALE_NS)('app.title'),
    locale: LOCALE_NS,
    inject: () => ({ readLocale: () => ctx.locale.getLocale().active }),
  }, Launcher))
  ctx.slots.inject('settings.apps.item', () => ctx.slots.register({
    name: 'settings.apps.item',
    id: APP_ID,
    locale: LOCALE_NS,
  }, Settings))
  const appConversations = ctx.get('appConversations')
  if (appConversations === undefined) throw new Error(APP_TITLE + ' requires app conversations')
  ctx.effect(() => appConversations.register({
    id: APP_ID,
    actions: { analyze: prepareAnalyzeAction },
  }), APP_ID + ': Agent skill actions')
}
