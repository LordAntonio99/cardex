import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  PHONE_DEBOUNCE_MS,
  PHONE_MAX_INFLIGHT,
  PHONE_MAX_UPLOAD,
  PHONE_STALE_MS
} from '@shared/scan-tuning'
import type { PhoneAddress, PhoneCaptureAck, PhoneSession, PhoneState } from '@shared/types'
import { broadcast } from '../events'
import { log } from '../log'
import * as recognizer from '../recognition/service'
import * as scan from '../repositories/scan'
import { getSettings, patchSettings } from '../settings'
import { ensureCertificate } from './cert'
import { lanAddresses } from './net'
import { renderPhonePage } from './page'

/**
 * El móvil como cámara del escáner.
 *
 * Un servidor HTTPS diminuto que sirve una página al móvil y recibe sus
 * fotografías. La imagen entra por el mismo sitio que la de la webcam
 * —`scan.identifyBuffer`— y el resultado se empuja al renderer, que lo encola en
 * el mismo lote. El móvil no puede escribir en la colección: sólo aporta
 * píxeles, y la revisión sigue ocurriendo en el ordenador.
 *
 * Sobre la seguridad, que aquí no es decorativa porque esto abre un puerto en la
 * red de casa:
 *
 *  - Token de 256 bits por sesión, y en la API va SÓLO en una cabecera. Si se
 *    aceptara por query, un `<img src=".../capture?t=...">` en cualquier página
 *    sería una petición simple y entraría. Con cabecera propia el navegador
 *    obliga a un preflight, y como nunca se responde con `Access-Control-Allow-*`
 *    ninguna página ajena puede llamar.
 *  - HTTPS, que además de ser obligatorio para la cámara mata el DNS rebinding,
 *    que es el ataque real contra los servidores locales: quien apunte su
 *    dominio a esta IP se queda sin TLS, porque el certificado no le cuadra.
 *  - El servidor sólo existe mientras el usuario lo tiene encendido, y el token
 *    muere con él.
 */

let server: Server | null = null
let token = ''
let state: PhoneState = 'off'
let message: string | undefined
let port: number | null = null
let address: string | null = null
let candidates: PhoneAddress[] = []
let lastSeenAt: number | null = null
let captureCount = 0
let accepted = 0
let inflight = 0
let lastCaptureAt = 0
let watch: NodeJS.Timeout | null = null
let wasConnected = false

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

// ── Estado ────────────────────────────────────────────────────────────────────

function connected(): boolean {
  return lastSeenAt !== null && Date.now() - lastSeenAt < PHONE_STALE_MS
}

export function session(): PhoneSession {
  return {
    state,
    url: state === 'listening' && address && port ? `https://${address}:${port}/s/${token}` : null,
    address,
    candidates,
    port,
    connected: connected(),
    lastSeenAt,
    captureCount,
    ...(message ? { message } : {})
  }
}

function emit(): void {
  broadcast('phone:session', session())
}

/** ¿Hay sesión de móvil viva? Lo consulta `scan:release` antes de soltar el motor. */
export function isActive(): boolean {
  return state === 'listening'
}

/**
 * El lote se ha confirmado, así que el contador que ve el móvil vuelve a cero.
 *
 * El lote de verdad vive en el renderer y main no lo conoce; lo que se cuenta
 * aquí son las cartas que ha aportado este móvil desde la última confirmación.
 * Si el usuario vacía el lote a mano en el ordenador el número queda alto hasta
 * la siguiente confirmación: es un contador descuadrado, no un dato erróneo, y
 * no compensa un canal nuevo para arreglarlo.
 */
export function batchCommitted(): void {
  accepted = 0
}

// ── Utilidades de respuesta ───────────────────────────────────────────────────

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
  // Nunca `Strict-Transport-Security`: envenenaría el origen y dejaría al
  // usuario sin poder entrar ni por http para ver qué pasa.
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function plain(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(body)
}

// ── Autenticación y contención ────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function authorized(req: IncomingMessage): boolean {
  const given = req.headers['x-cardex-token']
  return typeof given === 'string' && token !== '' && safeEqual(given, token)
}

/**
 * Nadie debería llegar aquí por un nombre de dominio.
 *
 * Con HTTPS el DNS rebinding ya se cae solo por el certificado, pero comprobar
 * que el `Host` es una dirección literal cuesta tres líneas y cierra la puerta
 * del todo.
 */
function hostAllowed(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (!host) return false
  const name = host.split(':')[0] ?? ''
  return IPV4.test(name) || name === 'localhost'
}

/** Si el navegador manda `Origin`, tiene que ser el nuestro. */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  return origin === `https://${req.headers.host}`
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? 0)
    // Rechazar por la cabecera antes de reservar un solo byte.
    if (declared > limit) {
      resolve(null)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
    req.on('aborted', () => resolve(null))
  })
}

// ── Rutas ─────────────────────────────────────────────────────────────────────

async function handleCapture(req: IncomingMessage, res: ServerResponse, source: 'live' | 'photo'): Promise<void> {
  // Dos capturas más juntas que el antirrebote son la misma carta contada dos
  // veces, y más de dos a la vez sólo consiguen que se encolen esperando al
  // reconocedor, que es de uno en uno.
  if (inflight >= PHONE_MAX_INFLIGHT || Date.now() - lastCaptureAt < PHONE_DEBOUNCE_MS) {
    json(res, 429, { error: 'busy' })
    return
  }

  const jpeg = await readBody(req, PHONE_MAX_UPLOAD)
  if (!jpeg || jpeg.byteLength === 0) {
    json(res, 413, { error: 'too_large' })
    return
  }

  lastCaptureAt = Date.now()
  lastSeenAt = lastCaptureAt
  inflight += 1
  try {
    const result = await scan.identifyBuffer(jpeg)
    captureCount += 1
    if (result.detection) accepted += 1

    // El renderer lo encola en el mismo lote que las capturas de la webcam.
    broadcast('phone:scan', { result, source })
    emit()

    const ack: PhoneCaptureAck = {
      status: result.status,
      name: result.detection?.name ?? null,
      numberLabel: result.detection?.numberLabel ?? null,
      accepted
    }
    json(res, 200, ack)
  } catch (e) {
    log.error('Una captura del móvil ha fallado', e)
    json(res, 500, { error: 'engine' })
  } finally {
    inflight -= 1
  }
}

function handlePing(res: ServerResponse): void {
  const first = !connected()
  lastSeenAt = Date.now()
  if (first) emit()
  json(res, 200, { alive: true, accepted, engine: recognizer.engineStatus().state })
}

function handlePage(res: ServerResponse, debug: boolean): void {
  const nonce = randomBytes(16).toString('base64')
  const settings = getSettings()
  const html = renderPhonePage(
    { token, lang: settings.uiLang, auto: settings.scanAutoCapture, debug },
    nonce
  )
  res.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    // El script va en línea, así que lleva nonce. Todo lo demás, cerrado: esta
    // página no carga nada de fuera y no tiene por qué poder hacerlo.
    'Content-Security-Policy':
      "default-src 'none'; " +
      `script-src 'nonce-${nonce}'; ` +
      "style-src 'unsafe-inline'; " +
      'img-src data: blob:; ' +
      "connect-src 'self'; " +
      "base-uri 'none'; " +
      "form-action 'none'"
  })
  res.end(html)
}

function route(req: IncomingMessage, res: ServerResponse): void {
  try {
    dispatch(req, res)
  } catch (e) {
    // Esto escucha en la red: una petición torcida no puede tumbar el proceso.
    log.warn(`Petición del móvil descartada: ${e instanceof Error ? e.message : e}`)
    if (!res.headersSent) plain(res, 400, 'Petición no válida.')
  }
}

function dispatch(req: IncomingMessage, res: ServerResponse): void {
  if (!hostAllowed(req) || !originAllowed(req)) {
    plain(res, 403, 'No.')
    return
  }

  const url = new URL(req.url ?? '/', 'https://cardex.invalid')

  // La página lleva el token en la RUTA porque una navegación no puede llevar
  // cabeceras. No es un agujero: una navegación no deja leer la respuesta desde
  // otro origen, y es la API la que exige la cabecera.
  if (req.method === 'GET' && url.pathname.startsWith('/s/')) {
    if (!safeEqual(url.pathname.slice(3), token)) {
      plain(res, 401, 'Enlace caducado. Vuelve a escanear el QR desde Cardex.')
      return
    }
    handlePage(res, url.searchParams.get('debug') === '1')
    return
  }

  if (req.method === 'POST' && (url.pathname === '/capture' || url.pathname === '/ping')) {
    if (!authorized(req)) {
      json(res, 401, { error: 'token' })
      return
    }
    if (url.pathname === '/ping') {
      handlePing(res)
      return
    }
    void handleCapture(req, res, url.searchParams.get('source') === 'photo' ? 'photo' : 'live').catch(
      (e) => {
        log.error('Fallo al atender una captura del móvil', e)
        if (!res.headersSent) json(res, 500, { error: 'internal' })
      }
    )
    return
  }

  // Ni un solo `Access-Control-Allow-*`, tampoco en el preflight: es lo que
  // impide que una página cualquiera de la red hable con este servidor.
  plain(res, 404, 'No hay nada aquí.')
}

// ── Ciclo de vida ─────────────────────────────────────────────────────────────

/** Prueba puertos consecutivos hasta encontrar uno libre. */
function listen(srv: Server, first: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryPort = (): void => {
      const candidate = first + attempt
      const onError = (e: NodeJS.ErrnoException): void => {
        srv.removeListener('listening', onListening)
        if (e.code === 'EADDRINUSE' && attempt < 9) {
          attempt += 1
          tryPort()
          return
        }
        reject(e)
      }
      const onListening = (): void => {
        srv.removeListener('error', onError)
        resolve(candidate)
      }
      srv.once('error', onError)
      srv.once('listening', onListening)
      // En 0.0.0.0 a propósito: así la dirección que se enseña en el QR es sólo
      // una decisión de presentación, y cambiarla no obliga a reiniciar nada ni
      // invalida la excepción de certificado que el móvil ya haya aceptado.
      srv.listen(candidate, '0.0.0.0')
    }
    tryPort()
  })
}

export async function start(): Promise<PhoneSession> {
  if (server || state === 'starting') return session()

  state = 'starting'
  message = undefined
  emit()

  try {
    candidates = await lanAddresses()
    if (!candidates.length) {
      throw new Error('Este ordenador no está conectado a ninguna red local')
    }

    const settings = getSettings()
    const saved = candidates.find((c) => c.address === settings.phoneAddress)
    address = saved?.address ?? candidates[0]?.address ?? null

    // El certificado cubre TODAS las candidatas, no sólo la elegida: así
    // cambiar de dirección en el desplegable no obliga a regenerarlo ni a pasar
    // otra vez por el aviso del móvil.
    const cert = await ensureCertificate(candidates.map((c) => c.address))
    token = randomBytes(32).toString('base64url')

    const srv = createServer({ key: cert.key, cert: cert.cert }, route)
    // Un cliente que abre la conexión y no habla no debe retener un socket.
    srv.requestTimeout = 30_000
    srv.headersTimeout = 10_000
    srv.keepAliveTimeout = 20_000
    srv.on('error', (e) => log.error('El servidor del escáner por móvil ha fallado', e))
    // Un certificado que el móvil no acepta llega aquí como error de TLS. No es
    // motivo para tirar el servidor: el usuario volverá a intentarlo.
    srv.on('tlsClientError', () => {})

    const bound = await listen(srv, settings.phonePort)
    server = srv
    port = bound
    if (bound !== settings.phonePort) patchSettings({ phonePort: bound })

    lastSeenAt = null
    captureCount = 0
    accepted = 0
    wasConnected = false
    state = 'listening'
    emit()

    // El indicador de «conectado» se apaga solo cuando el móvil deja de latir,
    // y nadie va a preguntar por él: hay que mirarlo desde aquí.
    watch = setInterval(() => {
      const now = connected()
      if (now !== wasConnected) {
        wasConnected = now
        emit()
      }
    }, 2000)

    // Cargar el modelo lleva un segundo largo. Se adelanta mientras el usuario
    // coge el móvil y pasa el aviso del certificado.
    void recognizer.start().catch(() => {
      // El estado del motor ya viaja por su cuenta; aquí sólo se calentaba.
    })

    log.info(`Escáner por móvil escuchando en https://${address}:${bound}`)
  } catch (e) {
    state = 'error'
    message = e instanceof Error ? e.message : String(e)
    log.error('No se ha podido arrancar el escáner por móvil', e)
    emit()
  }

  return session()
}

export function stop(): void {
  if (watch) {
    clearInterval(watch)
    watch = null
  }
  if (server) {
    server.close()
    // `close()` espera a que terminen las conexiones vivas, y el móvil mantiene
    // la suya abierta con el latido: sin esto el puerto tardaría en soltarse.
    server.closeAllConnections()
    server = null
  }
  token = ''
  state = 'off'
  message = undefined
  port = null
  lastSeenAt = null
  wasConnected = false
  inflight = 0
  emit()
}

/** Cambia la dirección del QR. No reinicia nada: el servidor escucha en 0.0.0.0. */
export function useAddress(next: string): PhoneSession {
  if (candidates.some((c) => c.address === next)) {
    address = next
    patchSettings({ phoneAddress: next })
    emit()
  }
  return session()
}
