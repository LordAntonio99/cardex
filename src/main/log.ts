import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * Registro mínimo: consola siempre, y fichero en userData/logs para poder pedir
 * un log cuando algo falle en la máquina de otra persona.
 *
 * Se evita una dependencia externa a propósito; esto son treinta líneas y no
 * tiene por qué crecer.
 */

const MAX_BYTES = 2 * 1024 * 1024

let logFile: string | null = null

function file(): string | null {
  if (logFile) return logFile
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'main.log')
    return logFile
  } catch {
    return null
  }
}

function rotate(target: string): void {
  try {
    if (existsSync(target) && statSync(target).size > MAX_BYTES) {
      renameSync(target, `${target}.1`)
    }
  } catch {
    // Si la rotación falla seguimos escribiendo: perder el log no es motivo
    // para tumbar la aplicación.
  }
}

function write(level: string, msg: string): void {
  const line = `${new Date().toISOString()} [${level}] ${msg}`
  if (level === 'ERROR') console.error(line)
  else if (level === 'WARN') console.warn(line)
  else console.log(line)

  const target = file()
  if (!target) return
  rotate(target)
  try {
    appendFileSync(target, `${line}\n`)
  } catch {
    // idem
  }
}

function format(e: unknown): string {
  if (e instanceof Error) return `${e.message}\n${e.stack ?? ''}`
  return String(e)
}

export const log = {
  info: (msg: string): void => write('INFO', msg),
  warn: (msg: string): void => write('WARN', msg),
  error: (msg: string, err?: unknown): void =>
    write('ERROR', err === undefined ? msg : `${msg} -> ${format(err)}`),
  logsDir: (): string => path.join(app.getPath('userData'), 'logs')
}
