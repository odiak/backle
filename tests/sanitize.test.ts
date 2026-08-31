import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from '../src/export/exporter.js'

describe('sanitizeFilename', () => {
  it('通常のファイル名はそのまま', () => {
    expect(sanitizeFilename('資料 v2.pdf')).toBe('資料 v2.pdf')
  })

  it('Windows禁止文字を置換する', () => {
    expect(sanitizeFilename('a:b*c?d"e<f>g|h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
    expect(sanitizeFilename('path/to\\file')).toBe('path_to_file')
  })

  it('制御文字を置換する', () => {
    expect(sanitizeFilename('a\x00b\x1fc')).toBe('a_b_c')
  })

  it('末尾のドット・空白を除去する', () => {
    expect(sanitizeFilename('report.')).toBe('report')
    expect(sanitizeFilename('report ... ')).toBe('report')
  })

  it('Windows予約名の先頭にアンダースコアを付ける', () => {
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('con.txt')).toBe('_con.txt')
    expect(sanitizeFilename('NUL.tar.gz')).toBe('_NUL.tar.gz')
    expect(sanitizeFilename('COM1')).toBe('_COM1')
    expect(sanitizeFilename('lpt9.log')).toBe('_lpt9.log')
    // 予約名でないものはそのまま
    expect(sanitizeFilename('CONSOLE.txt')).toBe('CONSOLE.txt')
    expect(sanitizeFilename('COM10.txt')).toBe('COM10.txt')
  })

  it('空になった場合はプレースホルダを返す', () => {
    expect(sanitizeFilename('...')).toBe('_')
    expect(sanitizeFilename('')).toBe('_')
  })
})
