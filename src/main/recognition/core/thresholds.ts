/**
 * Los números que deciden.
 *
 * Están todos juntos a propósito: son el resultado de calibrar contra capturas
 * reales (`scripts/recog-eval.mjs`), no constantes de diseño, y se tocan como
 * un bloque. Si un día el modelo cambia, este fichero se recalibra entero.
 *
 * El criterio de calibración no es «acertar más»: es que NUNCA se acepte
 * automáticamente una carta equivocada. Una confirmación de más cuesta un clic;
 * una carta mal metida en la colección cuesta encontrarla y arreglarla.
 */

export const THRESHOLDS = {
  /** Varianza del laplaciano mínima de la carta rectificada. Por debajo, movida. */
  minSharpness: 120,
  /** Fracción máxima de píxeles quemados antes de pedir que se mueva la luz. */
  maxGlare: 0.06,

  /** Coseno mínimo para tomarse en serio al mejor candidato. */
  minCosine: 0.55,
  /** Coseno a partir del cual el parecido es de por sí concluyente. */
  autoCosine: 0.82,
  /** Distancia al primer candidato de OTRA carta que basta para no dudar. */
  autoMargin: 0.06,
  /** Por debajo de este margen hay ambigüedad: se recurre a lo impreso. */
  ambiguousMargin: 0.03,
  /** Dos referencias por encima de esto comparten ilustración (reimpresiones). */
  sameArtCosine: 0.95,

  /** Candidatos que se devuelven para el selector de confirmación. */
  topK: 5
} as const
