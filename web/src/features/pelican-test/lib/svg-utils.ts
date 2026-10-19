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
import DOMPurify from 'dompurify'

const SVG_DOCUMENT_PATTERN = /<svg\b[^>]*(?:\/>|>[\s\S]*?<\/svg\s*>)/i
const SVG_FENCE_PATTERN = /```(?:svg|xml)?\s*([\s\S]*?)```/i

export function extractSvg(content: string): string | null {
  const fenced = content.match(SVG_FENCE_PATTERN)?.[1] ?? content
  const match = fenced.match(SVG_DOCUMENT_PATTERN)
  if (!match) return null

  const sanitized = DOMPurify.sanitize(match[0], {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    FORBID_TAGS: [
      'script',
      'foreignObject',
      'iframe',
      'object',
      'embed',
      'image',
      'feImage',
      'a',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
    ],
    ALLOW_DATA_ATTR: false,
  })
  const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml')
  const svg = parsed.documentElement
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) {
    return null
  }

  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')

  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.localName === 'style') {
      const css = element.textContent ?? ''
      const nonLocalCss = css.replaceAll(/url\(\s*(['"]?)#[\w.-]+\1\s*\)/gi, '')
      if (/@|\\|url\s*\(/i.test(nonLocalCss)) {
        element.remove()
        continue
      }
    }
    for (const attributeName of element.getAttributeNames()) {
      const attributeValue = element.getAttribute(attributeName) ?? ''
      const nonLocalValue = attributeValue.replaceAll(
        /url\(\s*(['"]?)#[\w.-]+\1\s*\)/gi,
        ''
      )
      const isExternalLink =
        (attributeName === 'href' || attributeName === 'xlink:href') &&
        !/^#[\w.-]+$/.test(attributeValue)
      if (
        isExternalLink ||
        /\\|url\s*\(/i.test(nonLocalValue) ||
        (attributeName === 'style' && /@/.test(attributeValue))
      ) {
        element.removeAttribute(attributeName)
      }
    }
  }

  const safeSvg = new XMLSerializer().serializeToString(svg)
  return /<svg\b/i.test(safeSvg) ? safeSvg : null
}

export function getSafeDownloadName(model: string, index: number): string {
  const safeModel = model
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .replace(/^\.+/, '')
    .replaceAll(/^-+|-+$/g, '')
  return `${safeModel || 'pelican-test'}-${index}.svg`
}
