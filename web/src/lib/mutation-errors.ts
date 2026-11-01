/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { isAxiosError } from 'axios'
import { toast } from 'sonner'

/**
 * onError for mutations whose requests pass skipBusinessError. Transport
 * errors (HTTP 4xx/5xx, network) were already toasted by the axios
 * interceptor, so only business errors thrown from a success:false body are
 * shown here, keeping exactly one toast per failure.
 */
export function toastBusinessError(error: Error, fallback: string): void {
  if (isAxiosError(error)) return
  toast.error(error.message || fallback)
}

/**
 * Message for a failed query: server-translated business messages are shown
 * as is; axios transport errors (English "Network Error", "status code 502")
 * fall back to the caller's translated text.
 */
export function queryErrorMessage(error: Error, fallback: string): string {
  if (isAxiosError(error)) return fallback
  return error.message || fallback
}
