import { useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

const APP_ID = 'video-sherlock-app'
const APP_TITLE = 'Video Sherlock'
const OPEN_PATH = '/api/apps/video-sherlock-app/open'

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

function Launcher({ wide = false, closeApps }) {
  const [busy, setBusy] = useState(false)
  const open = async () => {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(OPEN_PATH, { method: 'POST' })
      const value = await response.json()
      if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Unable to open App')
      if (value.opened !== true && typeof value.url === 'string') window.open(value.url, '_blank', 'noopener,noreferrer')
      closeApps?.()
    } finally {
      setBusy(false)
    }
  }
  const label = busy ? `Opening ${APP_TITLE}…` : APP_TITLE
  return jsx(Tooltip, {
    label: APP_TITLE,
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

function Settings() {
  return jsx('div', {
    style: { display: 'grid', gap: 4, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, lineHeight: 1.5 },
    children: [
      jsx('strong', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 }, children: 'Video evidence workspace' }),
      jsx('span', { children: 'Injects analyze-video + video-sherlock-visualize and renders their case artifacts as interactive dashboards.' }),
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
    title: metadataOnly ? 'Run video reconnaissance' : 'Investigate video',
    sessionTitle: `[Video Sherlock] ${analysisId}`,
    prompt: instructions.join('\n'),
  }
}

export const inject = ['slots', 'appConversations']

export function apply(ctx) {
  ctx.slots.inject('sidebar.apps', () => ctx.slots.register({
    name: 'sidebar.apps',
    id: APP_ID,
    order: 20,
    label: APP_TITLE,
  }, Launcher))
  ctx.slots.inject('settings.apps.item', () => ctx.slots.register({
    name: 'settings.apps.item',
    id: APP_ID,
  }, Settings))
  const appConversations = ctx.get('appConversations')
  if (appConversations === undefined) throw new Error(APP_TITLE + ' requires app conversations')
  ctx.effect(() => appConversations.register({
    id: APP_ID,
    actions: { analyze: prepareAnalyzeAction },
  }), APP_ID + ': Agent skill actions')
}
