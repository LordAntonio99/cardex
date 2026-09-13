import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { log } from '../log'

/**
 * El certificado del servidor del móvil.
 *
 * Hace falta HTTPS y no es negociable: `getUserMedia` exige contexto seguro, y
 * `http://192.168.x.x` no lo es —en un origen inseguro `navigator.mediaDevices`
 * ni siquiera existe, así que no hay ni error que capturar—. Como para una IP
 * de red local no existe autoridad que firme nada, el certificado es propio y
 * el móvil enseñará un aviso la primera vez.
 *
 * Se guarda en userData y se reutiliza. Es la razón de que el puerto también sea
 * fijo: el navegador recuerda la excepción por host Y puerto, y regenerar
 * cualquiera de los dos obliga al usuario a pasar el aviso otra vez.
 */

export interface PhoneCert {
  key: string
  cert: string
  /** Nombres y direcciones que el certificado cubre. */
  hosts: string[]
  notAfter: number
}

const DAY = 86_400_000
/**
 * iOS rechaza de plano cualquier certificado de más de 398 días desde iOS 13.
 * Un año redondo se queda cómodamente por debajo.
 */
const VALID_DAYS = 365
/** Se renueva con margen: uno a punto de caducar da errores más confusos. */
const RENEW_BEFORE = 30 * DAY

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/

interface Meta {
  hosts: string[]
  notAfter: number
}

function dir(): string {
  const target = path.join(app.getPath('userData'), 'phone')
  if (!existsSync(target)) mkdirSync(target, { recursive: true })
  return target
}

function read(): (PhoneCert & { meta: Meta }) | null {
  try {
    const base = dir()
    const meta = JSON.parse(readFileSync(path.join(base, 'meta.json'), 'utf8')) as Meta
    if (!Array.isArray(meta.hosts) || typeof meta.notAfter !== 'number') return null
    return {
      key: readFileSync(path.join(base, 'key.pem'), 'utf8'),
      cert: readFileSync(path.join(base, 'cert.pem'), 'utf8'),
      hosts: meta.hosts,
      notAfter: meta.notAfter,
      meta
    }
  } catch {
    // No existe todavía, o está a medias. Se genera uno nuevo.
    return null
  }
}

/**
 * Devuelve un certificado que cubra `hosts`, generándolo si hace falta.
 *
 * Se regenera cuando falta, cuando le quedan menos de treinta días o cuando la
 * dirección que se va a usar no está entre las que cubre —eso último pasa en
 * cuanto el portátil cambia de red.
 */
export async function ensureCertificate(hosts: string[]): Promise<PhoneCert> {
  const wanted = Array.from(new Set(['localhost', '127.0.0.1', ...hosts])).sort()
  const existing = read()

  if (
    existing &&
    existing.notAfter - Date.now() > RENEW_BEFORE &&
    wanted.every((h) => existing.hosts.includes(h))
  ) {
    return { key: existing.key, cert: existing.cert, hosts: existing.hosts, notAfter: existing.notAfter }
  }

  // Se carga aquí y no arriba: son unos cuantos cientos de kilobytes de
  // criptografía en JavaScript que la mayoría de arranques no llegan a tocar.
  const { generate } = await import('selfsigned')

  // Un día de margen hacia atrás. Con el reloj del sistema adelantado, un
  // certificado «todavía no válido» da un error que en algunos navegadores ni
  // siquiera ofrece el botón de continuar.
  const notBefore = new Date(Date.now() - DAY)
  const notAfter = new Date(notBefore.getTime() + VALID_DAYS * DAY)

  const pems = await generate([{ name: 'commonName', value: 'Cardex' }], {
    // Curva elíptica, no RSA: generar una clave RSA de 2048 bits en JavaScript
    // puro bloquea el proceso principal varios segundos, y P-256 es instantáneo
    // y lo aceptan todos los navegadores.
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      // Para una clave ECDSA lo correcto es sólo `digitalSignature`:
      // `keyEncipherment` es de RSA y aquí no significaría nada.
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        // Desde Chrome 58 el commonName se ignora por completo: si la dirección
        // no está aquí, el certificado no vale para nada.
        altNames: wanted.map((host) =>
          IPV4.test(host) ? { type: 7 as const, ip: host } : { type: 2 as const, value: host }
        )
      }
    ]
  })

  const base = dir()
  writeFileSync(path.join(base, 'key.pem'), pems.private, { encoding: 'utf8', mode: 0o600 })
  writeFileSync(path.join(base, 'cert.pem'), pems.cert, { encoding: 'utf8', mode: 0o600 })
  const meta: Meta = { hosts: wanted, notAfter: notAfter.getTime() }
  writeFileSync(path.join(base, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')

  log.info(`Certificado del escáner por móvil generado para ${wanted.join(', ')}`)
  return { key: pems.private, cert: pems.cert, hosts: wanted, notAfter: notAfter.getTime() }
}
