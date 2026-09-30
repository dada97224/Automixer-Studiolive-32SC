/**
 * Courbes fil (0..1) vers unités humaines.
 *
 * Sources :
 * - Fader : trois ancres publiées par ucmix (0 = -84 dB, 0.746 = -6 dB, 1 = +10 dB).
 *   Mesurées sur une Series III en firmware 3.4.0, pas sur 2.8.2.103375.
 *   Le polynôme featherbear a été écarté par ucmix : il place 0 dB près de 0.746,
 *   alors que la capture place -6 dB à cet endroit.
 * - Limiteur : droite -28..0 dB, confirmée (1.0 = 0 dB, 0.785714 ≈ -6 dB),
 *   même réserve de firmware.
 *
 * Les paramètres gate/comp hors booléens n'ont pas de courbe attestée :
 * ils ne sont pas convertis ici.
 */

export class CourbeHorsPlageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CourbeHorsPlageError";
  }
}

interface Ancre {
  position: number;
  humain: number;
}

const ANGRES_FADER: readonly Ancre[] = [
  { position: 0, humain: -84 },
  { position: 0.746, humain: -6 },
  { position: 1, humain: 10 },
];

const FADER_MIN_DB = -84;
const FADER_MAX_DB = 10;
const LIMITEUR_MIN_DB = -28;
const LIMITEUR_MAX_DB = 0;

function interpolerVersHumain(ancres: readonly Ancre[], position: number): number {
  const premiere = ancres[0];
  const derniere = ancres[ancres.length - 1];
  if (premiere === undefined || derniere === undefined) {
    throw new CourbeHorsPlageError("courbe sans ancre");
  }
  if (position <= premiere.position) return premiere.humain;
  if (position >= derniere.position) return derniere.humain;
  for (let i = 1; i < ancres.length; i += 1) {
    const gauche = ancres[i - 1];
    const droite = ancres[i];
    if (gauche === undefined || droite === undefined) continue;
    if (position <= droite.position) {
      const fraction = (position - gauche.position) / (droite.position - gauche.position);
      return gauche.humain + fraction * (droite.humain - gauche.humain);
    }
  }
  return derniere.humain;
}

function interpolerVersFil(ancres: readonly Ancre[], humain: number): number {
  const premiere = ancres[0];
  const derniere = ancres[ancres.length - 1];
  if (premiere === undefined || derniere === undefined) {
    throw new CourbeHorsPlageError("courbe sans ancre");
  }
  if (humain < premiere.humain) return premiere.position;
  if (humain > derniere.humain) {
    throw new CourbeHorsPlageError(`${humain} dB au-dessus de ${derniere.humain} dB`);
  }
  for (let i = 1; i < ancres.length; i += 1) {
    const gauche = ancres[i - 1];
    const droite = ancres[i];
    if (gauche === undefined || droite === undefined) continue;
    if (humain <= droite.humain) {
      const fraction = (humain - gauche.humain) / (droite.humain - gauche.humain);
      return gauche.position + fraction * (droite.position - gauche.position);
    }
  }
  return derniere.position;
}

/** Certaines lectures featherbear exposent le fader sur 0..100 au lieu de 0..1. */
export function normaliserFilVolume(valeur: number): number {
  if (!Number.isFinite(valeur)) {
    throw new CourbeHorsPlageError("volume fil non fini");
  }
  if (valeur > 1.5) return valeur / 100;
  return valeur;
}

export function faderDbVersFil(db: number): number {
  if (db > FADER_MAX_DB) {
    throw new CourbeHorsPlageError(`fader ${db} dB > +10 dB`);
  }
  return interpolerVersFil(ANGRES_FADER, Math.max(db, FADER_MIN_DB));
}

export function faderFilVersDb(fil: number): number {
  return interpolerVersHumain(ANGRES_FADER, normaliserFilVolume(fil));
}

export function limiteurDbVersFil(db: number): number {
  if (db > LIMITEUR_MAX_DB || db < LIMITEUR_MIN_DB) {
    throw new CourbeHorsPlageError(`limiteur ${db} dB hors -28..0`);
  }
  return (db - LIMITEUR_MIN_DB) / (LIMITEUR_MAX_DB - LIMITEUR_MIN_DB);
}

export function limiteurFilVersDb(fil: number): number {
  const borne = Math.min(1, Math.max(0, fil));
  return LIMITEUR_MIN_DB + borne * (LIMITEUR_MAX_DB - LIMITEUR_MIN_DB);
}

export interface PointCalibration {
  humain: number;
  fil: number;
}

/**
 * Interpolation linéaire entre points saisis sur la console.
 * Deux points minimum : on n'extrapole pas une courbe inconnue.
 */
export function filDepuisCalibration(points: readonly PointCalibration[], humain: number): number {
  if (points.length < 2) {
    throw new CourbeHorsPlageError("calibration insuffisante (deux points requis)");
  }
  const tries = [...points].sort((a, b) => a.humain - b.humain);
  const premier = tries[0];
  const dernier = tries[tries.length - 1];
  if (premier === undefined || dernier === undefined) {
    throw new CourbeHorsPlageError("calibration vide");
  }
  if (humain < premier.humain - 1e-9 || humain > dernier.humain + 1e-9) {
    throw new CourbeHorsPlageError(
      `${humain} hors de la calibration [${premier.humain}, ${dernier.humain}]`,
    );
  }
  for (let i = 1; i < tries.length; i += 1) {
    const gauche = tries[i - 1];
    const droite = tries[i];
    if (gauche === undefined || droite === undefined) continue;
    if (humain <= droite.humain) {
      const ecart = droite.humain - gauche.humain;
      if (Math.abs(ecart) < 1e-12) return droite.fil;
      const fraction = (humain - gauche.humain) / ecart;
      return gauche.fil + fraction * (droite.fil - gauche.fil);
    }
  }
  return dernier.fil;
}
