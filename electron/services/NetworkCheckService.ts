import { net } from 'electron'

/**
 * Откуда Anthropic видит наши запросы.
 *
 * Список IP-адресов Anthropic для этого не нужен и не помог бы: они за
 * Cloudflare, диапазоны меняются, а знание адреса сервера ничего не говорит
 * о нашем собственном выходе в сеть. Вместо этого спрашиваем сам API —
 * `/cdn-cgi/trace` отдаёт наш внешний IP, страну и дата-центр Cloudflare
 * ровно для того хоста, куда ходит CLI. Проверка получается честной.
 *
 * Ответ — plain text вида:
 *   ip=95.85.227.59
 *   loc=PL
 *   colo=WAW
 *   warp=off
 */

const TRACE_URL = 'https://api.anthropic.com/cdn-cgi/trace'
const TIMEOUT_MS = 8000

export interface NetworkInfo {
  ok: boolean
  /** внешний IP, каким его видит Anthropic */
  ip: string | null
  /** ISO-код страны выхода */
  country: string | null
  /** дата-центр Cloudflare (WAW, FRA, …) */
  colo: string | null
  /** сеть недоступна — вердикт о стране выносить нельзя */
  offline: boolean
  error?: string
}

function parseTrace(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export async function fetchNetworkInfo(): Promise<NetworkInfo> {
  const offlineResult = (error: string): NetworkInfo => ({
    ok: false, ip: null, country: null, colo: null, offline: true, error,
  })

  return new Promise<NetworkInfo>(resolve => {
    let settled = false
    const done = (r: NetworkInfo) => { if (!settled) { settled = true; resolve(r) } }

    // net из Electron, а не fetch: он ходит через системный стек и уважает
    // системный прокси — то есть видит сеть так же, как её увидит CLI
    const request = net.request({ method: 'GET', url: TRACE_URL })

    const timer = setTimeout(() => {
      try { request.abort() } catch {}
      done(offlineResult('timeout'))
    }, TIMEOUT_MS)

    request.on('response', response => {
      let body = ''
      response.on('data', chunk => { body += chunk.toString() })
      response.on('end', () => {
        clearTimeout(timer)
        const t = parseTrace(body)
        done({
          ok: true,
          ip: t.ip ?? null,
          country: (t.loc ?? '').toUpperCase() || null,
          colo: (t.colo ?? '').toUpperCase() || null,
          offline: false,
        })
      })
      response.on('error', (e: Error) => {
        clearTimeout(timer)
        done(offlineResult(e.message))
      })
    })

    request.on('error', (e: Error) => {
      clearTimeout(timer)
      done(offlineResult(e.message))
    })

    try { request.end() } catch (e) {
      clearTimeout(timer)
      done(offlineResult(e instanceof Error ? e.message : String(e)))
    }
  })
}
