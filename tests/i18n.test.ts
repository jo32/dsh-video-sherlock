import { describe, expect, test } from 'bun:test'
import { createTranslator, en, normalizeUiLocale, resolveUiLocale, zh } from '../src/app/i18n'

describe('Video Sherlock UI i18n', () => {
  test('ships matching Chinese and English key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  test('normalizes supported regional language tags', () => {
    expect(normalizeUiLocale('zh-CN')).toBe('zh')
    expect(normalizeUiLocale('en-GB')).toBe('en')
    expect(normalizeUiLocale('ja-JP')).toBeUndefined()
  })

  test('prefers the explicit DeepDeck locale and falls back to browser requests', () => {
    expect(resolveUiLocale('en', ['zh-CN'])).toBe('en')
    expect(resolveUiLocale(undefined, ['ja-JP', 'zh-Hans-CN'])).toBe('zh')
    expect(resolveUiLocale(undefined, ['ja-JP'])).toBe('en')
  })

  test('interpolates localized UI values', () => {
    expect(createTranslator('zh')('player.highlights', { count: 3 })).toBe('3 个证据高光')
    expect(createTranslator('en')('player.jumpToEvidence', { time: '01:24' })).toBe('Jump to evidence highlight at 01:24')
  })
})
