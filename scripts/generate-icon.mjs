// bckle のアイコンを生成する素朴なスクリプト（依存パッケージなし）
// 使い方: node scripts/generate-icon.mjs
// 出力: build/icon.png (1024px, electron-builder用) / gui/public/favicon.png (64px)
//
// モチーフ: 名前の由来である belt buckle（バックル）。
// 角丸タイル + 白いバックルのフレーム + ピン（prong）。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- 図形（SDF: 負なら内側） ----

function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r
}

// SDF → カバレッジ（1pxぶんのアンチエイリアス）
function coverage(d, aa) {
  return Math.min(1, Math.max(0, 0.5 - d / aa))
}

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4)
  const s = size / 1024 // 1024基準の座標系
  const aa = 1 / s // デバイスピクセルで約1px

  // タイル: 中央の角丸正方形（macOS流儀で周囲に余白を残す）
  const tileHalf = 412 // 824/1024
  const tileR = 186

  // バックルのフレーム（横長の角丸リング）
  const frameHW = 250
  const frameHH = 190
  const frameR = 92
  const thickness = 58
  // ピン: 左フレーム内側から右へ伸びる横棒（カプセル）
  const prongHH = 26
  const prongX1 = 512 - frameHW + 20
  const prongX2 = 512 + 130

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // ピクセル中心を1024座標系へ
      const gx = (x + 0.5) / s
      const gy = (y + 0.5) / s

      const dTile = sdRoundedRect(gx, gy, 512, 512, tileHalf, tileHalf, tileR)
      const aTile = coverage(dTile, aa)

      // 背景: 縦グラデーション（緑〜深いティール）
      const t = Math.min(1, Math.max(0, (gy - (512 - tileHalf)) / (tileHalf * 2)))
      let r = 52 + (16 - 52) * t
      let g = 178 + (112 - 178) * t
      let b = 136 + (100 - 136) * t

      // ほんのり上部ハイライト
      const hl = Math.max(0, 1 - t * 2.4) * 0.10
      r += (255 - r) * hl
      g += (255 - g) * hl
      b += (255 - b) * hl

      // バックル（フレーム = 外側角丸 − 内側角丸）
      const dOuter = sdRoundedRect(gx, gy, 512, 512, frameHW, frameHH, frameR)
      const dInner = sdRoundedRect(
        gx, gy, 512, 512,
        frameHW - thickness, frameHH - thickness, frameR - thickness * 0.72,
      )
      const aFrame = coverage(dOuter, aa) * (1 - coverage(dInner, aa))

      // ピン（横カプセル）
      const dProng = sdRoundedRect(
        gx, gy, (prongX1 + prongX2) / 2, 512,
        (prongX2 - prongX1) / 2, prongHH, prongHH,
      )
      const aProng = coverage(dProng, aa)

      // 白を合成（フレームとピンの重なりはmaxで統合）
      const aWhite = Math.max(aFrame, aProng)
      r += (255 - r) * aWhite
      g += (255 - g) * aWhite
      b += (255 - b) * aWhite

      const i = (y * size + x) * 4
      px[i] = Math.round(r * aTile)
      px[i + 1] = Math.round(g * aTile)
      px[i + 2] = Math.round(b * aTile)
      px[i + 3] = Math.round(255 * aTile)
    }
  }
  return px
}

// ---- PNGエンコード（truecolor+alpha, filter 0） ----

const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA

  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function writeIcon(path, size) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, encodePng(renderIcon(size), size))
  console.log(`wrote ${path} (${size}x${size})`)
}

writeIcon(join(root, 'build/icon.png'), 1024)
writeIcon(join(root, 'gui/public/favicon.png'), 64)
