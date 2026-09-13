import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

/**
 * El código que el móvil escanea.
 *
 * Se dibuja como un único `<path>` en vez de un `<rect>` por módulo. Una URL con
 * el token dentro sale versión 5 o 6, que son más de mil módulos: mil elementos
 * en el árbol para pintar un cuadrado en blanco y negro. Fusionando los módulos
 * contiguos de cada fila en tramos, queda un solo nodo.
 *
 * Tampoco se usa `createSvgTag()` de la librería, que devuelve marcado y
 * obligaría a `dangerouslySetInnerHTML`: el atributo `d` es una cadena normal y
 * React la pinta sin más.
 */
export function QrCode({ value, size = 200 }: { value: string; size?: number }): React.JSX.Element {
  const { d, span } = useMemo(() => {
    // Corrección media: la alta alarga la versión del código sin necesidad, y
    // esto se lee a treinta centímetros de una pantalla, no en una caja mojada.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()

    const n = qr.getModuleCount()
    // La zona de silencio no es decorativa: sin ella muchos lectores no
    // encuentran los patrones de posición.
    const quiet = 4
    let path = ''

    for (let row = 0; row < n; row += 1) {
      let start = -1
      for (let col = 0; col <= n; col += 1) {
        const dark = col < n && qr.isDark(row, col)
        if (dark && start < 0) start = col
        if (!dark && start >= 0) {
          const width = col - start
          path += `M${start + quiet} ${row + quiet}h${width}v1h-${width}z`
          start = -1
        }
      }
    }

    return { d: path, span: n + quiet * 2 }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={value}
      style={{ display: 'block' }}
    >
      {/* Siempre claro de fondo y oscuro los módulos, dé igual el tema de la
          aplicación: un QR en negativo lo leen bastantes menos cámaras. */}
      <rect width={span} height={span} fill="#ffffff" />
      <path d={d} fill="#0d0e10" />
    </svg>
  )
}
