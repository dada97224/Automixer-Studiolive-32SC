import { RANGE_PAROLE_MAX_DB, RANGE_PAROLE_MIN_DB } from "./constantes.js";
import { filDepuisCalibration, type PointCalibration } from "./courbes.js";

export class RangeParoleError extends Error {
  constructor(readonly db: number) {
    super(
      `Range ${db} dB hors de la plage parole ${RANGE_PAROLE_MIN_DB}..${RANGE_PAROLE_MAX_DB} dB.`,
    );
    this.name = "RangeParoleError";
  }
}

/**
 * Le manuel Series III V6 §6.4.1 dit que Range est désactivé quand l'expander
 * est engagé. Le chemin UCNET du bouton Expander n'est pas attesté
 * (ucmix ne publie que gate/on, threshold, range, attack, release, ratio).
 * On n'invente donc pas gate/expander. L'atténuation douce demandée
 * (-12 à -20 dB) est portée par gate/range, actif en mode gate.
 */
export function assertRangeParole(db: number): number {
  if (!Number.isFinite(db) || db < RANGE_PAROLE_MIN_DB || db > RANGE_PAROLE_MAX_DB) {
    throw new RangeParoleError(db);
  }
  return db;
}

export interface EcritureRange {
  suffixe: "gate/on" | "gate/range";
  valeur: number | boolean;
  ecrit: boolean;
  raison: string;
}

export function preparerEcrituresExpander(
  rangeDb: number,
  calibrationRange: readonly PointCalibration[] | undefined,
): EcritureRange[] {
  const range = assertRangeParole(rangeDb);
  const ecritures: EcritureRange[] = [
    {
      suffixe: "gate/on",
      valeur: true,
      ecrit: true,
      raison: "booléen attesté",
    },
  ];
  if (calibrationRange === undefined || calibrationRange.length < 2) {
    ecritures.push({
      suffixe: "gate/range",
      valeur: range,
      ecrit: false,
      raison:
        "courbe fil de gate/range non attestée sur 2.8.2.103375 : saisie locale de deux points requise",
    });
    return ecritures;
  }
  ecritures.push({
    suffixe: "gate/range",
    valeur: filDepuisCalibration(calibrationRange, range),
    ecrit: true,
    raison: "range parole converti par calibration locale",
  });
  return ecritures;
}
