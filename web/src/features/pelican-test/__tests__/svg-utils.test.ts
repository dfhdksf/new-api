/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version).

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import { extractSvg, getSafeDownloadName } from '../lib/svg-utils'

describe('extractSvg', () => {
  test('extracts SVG wrapped in a Markdown code fence', () => {
    expect(extractSvg('```svg\n<svg viewBox="0 0 1 1"></svg>\n```')).toContain(
      '<svg'
    )
  })

  test('removes active content before returning SVG for preview', () => {
    const svg = extractSvg(
      '<svg viewBox="0 0 1 1" onload="alert(1)"><script>alert(1)</script><circle cx=".5" cy=".5" r=".2"/></svg>'
    )
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('onload=')
    expect(svg).toContain('<circle')
  })

  test('preserves local styles and definitions and supplies the SVG namespace', () => {
    const svg = extractSvg(`<svg viewBox="0 0 10 10">
      <style>.bird { fill: url('#feathers'); stroke: navy; }</style>
      <defs><linearGradient id="feathers"><stop stop-color="gold" /></linearGradient><path id="wing" d="M0 0L5 5" /></defs>
      <use href="#wing" class="bird" style="stroke-width: 2" />
    </svg>`)

    expect(svg).toContain("fill: url('#feathers')")
    expect(svg).toContain('href="#wing"')
    expect(svg).toContain('style="stroke-width: 2"')
    const document = new DOMParser().parseFromString(svg ?? '', 'image/svg+xml')
    expect(document.documentElement.namespaceURI).toBe(
      'http://www.w3.org/2000/svg'
    )
    expect(document.querySelector('parsererror')).toBeNull()
  })

  test('removes external images, links, CSS resources, and SVG mutations', () => {
    const svg = extractSvg(`<svg viewBox="0 0 10 10">
      <style>@import "https://external.example/font.css";</style>
      <style>.bird { fill: url(https://external.example/paint); }</style>
      <image href="https://external.example/image.png" />
      <use href="https://external.example/shapes.svg#wing" />
      <path fill="url(https://external.example/paint)" style="fill: url(https://external.example/paint)" />
      <set attributeName="href" to="https://external.example/change" />
      <foreignObject><div>untrusted</div></foreignObject>
    </svg>`)

    expect(svg).not.toContain('external.example')
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('<set')
    expect(svg).not.toContain('foreignObject')
    expect(svg).toContain('<path')
  })

  test('returns null when the completion does not contain SVG markup', () => {
    expect(extractSvg('I cannot create an image.')).toBeNull()
  })
})

describe('getSafeDownloadName', () => {
  test('removes path characters from model-based download names', () => {
    expect(getSafeDownloadName('../model name', 2)).toBe('model-name-2.svg')
  })
})
