import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import type { PhoneAddress } from '@shared/types'

/**
 * Por qué dirección llega el móvil al ordenador.
 *
 * Parece trivial y no lo es: un Windows con Docker, WSL o Hyper-V instalados
 * tiene media docena de interfaces con IP privada, y sólo una está en la misma
 * red que el móvil. Peor aún, los nombres de adaptador están traducidos
 * («Conexión de área local* 9»), así que ninguna heurística por nombre vale por
 * sí sola. Se encadenan señales, de la más fuerte a la más débil, y al final se
 * enseñan todas las candidatas: desde dentro de la máquina no hay forma de
 * saberlo con certeza, y adivinar en silencio es peor que ofrecer una lista.
 */

/** Fabricantes de MAC de adaptadores virtuales. Esto sí es independiente del idioma. */
const VIRTUAL_OUI = [
  '00:15:5d', // Hyper-V, vEthernet, WSL
  '00:50:56', // VMware
  '00:0c:29', // VMware
  '00:05:69', // VMware
  '00:1c:14', // VMware
  '08:00:27', // VirtualBox
  '0a:00:27', // VirtualBox
  '02:42' // Docker
]

const VIRTUAL_NAME =
  /vEthernet|Hyper-?V|WSL|VirtualBox|VMware|VMnet|Default Switch|Docker|Loopback|Bluetooth|TAP|TUN|ZeroTier|Tailscale|Hamachi|Radmin|Npcap/i

/**
 * Sólo RFC1918.
 *
 * Deja fuera la APIPA (169.254/16, que es «no he encontrado DHCP» y no lleva a
 * ninguna parte) y el rango de CGNAT 100.64/10, por donde asoman Tailscale y
 * algunas VPN: son direcciones reales, pero no la red de casa.
 */
function privateRank(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  const [a, b] = parts as [number, number, number, number]
  // Los routers domésticos usan 192.168 de forma abrumadora, así que va primero.
  if (a === 192 && b === 168) return 0
  if (a === 10) return 1
  if (a === 172 && b >= 16 && b <= 31) return 2
  return null
}

function isVirtual(iface: string, mac: string): boolean {
  if (VIRTUAL_NAME.test(iface)) return true
  const low = mac.toLowerCase()
  return VIRTUAL_OUI.some((oui) => low.startsWith(oui))
}

/**
 * La dirección de la interfaz por la que sale el tráfico a internet.
 *
 * Un socket UDP «conectado» no manda un solo byte —UDP no tiene handshake—
 * pero obliga al sistema a resolver la ruta y asignar la dirección local. Es la
 * señal más fiable que hay sin leer la tabla de rutas, y la que descarta sola
 * todos los adaptadores virtuales, porque por ninguno de ellos se sale a la
 * calle.
 */
export function defaultRouteAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    let done = false
    const finish = (value: string | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Ya estaba cerrado: da igual, lo que queríamos era la dirección.
      }
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 300)
    socket.once('error', () => finish(null))
    try {
      socket.connect(53, '8.8.8.8', () => {
        try {
          finish(socket.address().address)
        } catch {
          finish(null)
        }
      })
    } catch {
      finish(null)
    }
  })
}

/**
 * Las direcciones por las que el móvil podría llegar, la mejor primero.
 *
 * Se recalcula cada vez que se pide: la IP cambia al cambiar de Wi-Fi y al
 * renovarse el DHCP, y una lista de hace media hora manda al usuario a una
 * dirección muerta.
 */
export async function lanAddresses(): Promise<PhoneAddress[]> {
  const preferred = await defaultRouteAddress()
  const found: { entry: PhoneAddress; rank: number }[] = []

  for (const [iface, infos] of Object.entries(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== 'IPv4') continue
      const rank = privateRank(info.address)
      if (rank === null) continue
      const isDefaultRoute = info.address === preferred
      // Un adaptador virtual que además resulte ser la ruta por defecto es un
      // caso raro pero legítimo (una VPN corporativa, por ejemplo): la señal
      // fuerte gana sobre el filtro por nombre.
      if (!isDefaultRoute && isVirtual(iface, info.mac)) continue
      found.push({ entry: { address: info.address, iface, isDefaultRoute }, rank })
    }
  }

  found.sort((a, b) => {
    if (a.entry.isDefaultRoute !== b.entry.isDefaultRoute) return a.entry.isDefaultRoute ? -1 : 1
    if (a.rank !== b.rank) return a.rank - b.rank
    return a.entry.address.localeCompare(b.entry.address)
  })

  return found.map((f) => f.entry)
}
