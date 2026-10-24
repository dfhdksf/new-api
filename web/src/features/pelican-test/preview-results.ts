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
import type { PelicanTestResult } from './types'

// Hand-drawn samples demonstrate the layout; they are not model benchmark results.
export const PREVIEW_RESULTS: PelicanTestResult[] = [
  {
    id: 1,
    connectionId: 'example-a',
    connectionName: 'example-a',
    credentialId: 'example-key-a',
    credentialName: 'Demo A',
    baseUrl: 'https://api-a.example.com/v1',
    apiFormat: 'responses',
    transport: 'direct',
    model: 'preview-model',
    effort: 'high',
    runNumber: 1,
    status: 'success',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340"><rect width="480" height="340" rx="20" fill="#eef8f5"/><ellipse cx="242" cy="289" rx="180" ry="12" fill="#334155" opacity=".08"/><g fill="none" stroke="#334155" stroke-width="6"><circle cx="120" cy="235" r="55"/><circle cx="355" cy="235" r="55"/><path d="M120 235 186 150 240 235 120 235M186 150 319 150 240 235M355 235 308 123" stroke="#1c9275" stroke-linejoin="round"/><path d="M168 144h36M303 123h32" stroke-linecap="round"/></g><path d="M218 158q-13 31 23 41l18 29M252 164l-13 38-25 27" fill="none" stroke="#eb9b38" stroke-width="9" stroke-linecap="round"/><path d="M151 127q22-43 79-15 26 12 38-13l-2-40q0-25 20-26 24 1 21 27l-5 51q-5 56-60 61-57 2-91-45" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M163 126q49-14 78 27-42 13-70-14" fill="#cbd5e1"/><path d="m300 57 104 15-104 16z" fill="#edab44" stroke="#334155" stroke-width="2"/><path d="M300 85q46 39 88-10" fill="#f7cc80" stroke="#334155" stroke-width="2"/><circle cx="289" cy="54" r="4" fill="#172554"/><path d="m156 125-25-12 16 25" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M255 114 305 139" stroke="#334155" stroke-width="4" stroke-linecap="round"/></svg>',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340"><rect width="480" height="340" rx="20" fill="#eef8f5"/><ellipse cx="242" cy="289" rx="180" ry="12" fill="#334155" opacity=".08"/><g fill="none" stroke="#334155" stroke-width="6"><circle cx="120" cy="235" r="55"/><circle cx="355" cy="235" r="55"/><path d="M120 235 186 150 240 235 120 235M186 150 319 150 240 235M355 235 308 123" stroke="#1c9275" stroke-linejoin="round"/><path d="M168 144h36M303 123h32" stroke-linecap="round"/></g><path d="M218 158q-13 31 23 41l18 29M252 164l-13 38-25 27" fill="none" stroke="#eb9b38" stroke-width="9" stroke-linecap="round"/><path d="M151 127q22-43 79-15 26 12 38-13l-2-40q0-25 20-26 24 1 21 27l-5 51q-5 56-60 61-57 2-91-45" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M163 126q49-14 78 27-42 13-70-14" fill="#cbd5e1"/><path d="m300 57 104 15-104 16z" fill="#edab44" stroke="#334155" stroke-width="2"/><path d="M300 85q46 39 88-10" fill="#f7cc80" stroke="#334155" stroke-width="2"/><circle cx="289" cy="54" r="4" fill="#172554"/><path d="m156 125-25-12 16 25" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M255 114 305 139" stroke="#334155" stroke-width="4" stroke-linecap="round"/></svg>',
    durationMs: null,
    totalTokens: null,
    error: null,
  },
  {
    id: 2,
    connectionId: 'example-b',
    connectionName: 'example-b',
    credentialId: 'example-key-b',
    credentialName: 'Demo B',
    baseUrl: 'https://api-b.example.com/v1',
    apiFormat: 'responses',
    transport: 'direct',
    model: 'preview-model',
    effort: 'high',
    runNumber: 1,
    status: 'success',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340"><rect width="480" height="340" rx="20" fill="#f6f2ff"/><ellipse cx="242" cy="289" rx="180" ry="12" fill="#334155" opacity=".08"/><g fill="none" stroke="#334155" stroke-width="6"><circle cx="120" cy="235" r="55"/><circle cx="355" cy="235" r="55"/><path d="M120 235 186 150 240 235 120 235M186 150 319 150 240 235M355 235 308 123" stroke="#8261c2" stroke-linejoin="round"/><path d="M168 144h36M303 123h32" stroke-linecap="round"/></g><path d="M218 158q-13 31 23 41l18 29M252 164l-13 38-25 27" fill="none" stroke="#eb9b38" stroke-width="9" stroke-linecap="round"/><path d="M151 127q22-43 79-15 26 12 38-13l-2-40q0-25 20-26 24 1 21 27l-5 51q-5 56-60 61-57 2-91-45" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M163 126q49-14 78 27-42 13-70-14" fill="#cbd5e1"/><path d="m300 57 104 15-104 16z" fill="#edab44" stroke="#334155" stroke-width="2"/><path d="M300 85q46 39 88-10" fill="#f7cc80" stroke="#334155" stroke-width="2"/><circle cx="289" cy="54" r="4" fill="#172554"/><path d="m156 125-25-12 16 25" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M255 114 305 139" stroke="#334155" stroke-width="4" stroke-linecap="round"/></svg>',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340"><rect width="480" height="340" rx="20" fill="#f6f2ff"/><ellipse cx="242" cy="289" rx="180" ry="12" fill="#334155" opacity=".08"/><g fill="none" stroke="#334155" stroke-width="6"><circle cx="120" cy="235" r="55"/><circle cx="355" cy="235" r="55"/><path d="M120 235 186 150 240 235 120 235M186 150 319 150 240 235M355 235 308 123" stroke="#8261c2" stroke-linejoin="round"/><path d="M168 144h36M303 123h32" stroke-linecap="round"/></g><path d="M218 158q-13 31 23 41l18 29M252 164l-13 38-25 27" fill="none" stroke="#eb9b38" stroke-width="9" stroke-linecap="round"/><path d="M151 127q22-43 79-15 26 12 38-13l-2-40q0-25 20-26 24 1 21 27l-5 51q-5 56-60 61-57 2-91-45" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M163 126q49-14 78 27-42 13-70-14" fill="#cbd5e1"/><path d="m300 57 104 15-104 16z" fill="#edab44" stroke="#334155" stroke-width="2"/><path d="M300 85q46 39 88-10" fill="#f7cc80" stroke="#334155" stroke-width="2"/><circle cx="289" cy="54" r="4" fill="#172554"/><path d="m156 125-25-12 16 25" fill="#fffdf5" stroke="#334155" stroke-width="3"/><path d="M255 114 305 139" stroke="#334155" stroke-width="4" stroke-linecap="round"/></svg>',
    durationMs: null,
    totalTokens: null,
    error: null,
  },
]
