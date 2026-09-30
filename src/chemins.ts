import { CANAL_MAX, CANAL_MIN } from "./constantes.js";

/**
 * Fragments qui ne doivent jamais être écrits, même si un appelant
 * les présente comme un test d'intégration.
 */
const FRAGMENTS_INTERDITS = [
  "48v",
  "avb",
  "usb",
  "clock",
  "sample",
  "stagebox",
  "remote",
  "preset",
  "scene",
  "project",
  "adc_src",
  "sd_src",
  "milan",
  "ptp",
  "phantom",
  "outputpatch",
  "networksetup",
  "digitalgain",
] as const;

/**
 * Suffixes autorisés sous line/ch{n}/. Uniquement le Fat Channel et le fader.
 * Pas de mute, pas de patch, pas de 48 V, pas de scène.
 */
const SUFFIXES_AUTORISES = new Set([
  "volume",
  "preampgain",
  "gate/on",
  "gate/threshold",
  "gate/range",
  "gate/attack",
  "gate/release",
  "gate/ratio",
  "comp/on",
  "comp/threshold",
  "comp/ratio",
  "comp/attack",
  "comp/release",
  "comp/gain",
  "comp/kneewidth",
  "comp/automode",
  "comp/softknee",
  "limit/limiteron",
  "limit/threshold",
  "limit/release",
]);

export class CheminRefuseError extends Error {
  constructor(readonly chemin: string, raison: string) {
    super(`Écriture refusée (${raison}) : ${chemin}`);
    this.name = "CheminRefuseError";
  }
}

export class VersionRefuseeError extends Error {
  constructor(readonly versionLue: string | undefined) {
    super(
      `Écriture refusée : global.mixer_version vaut ${versionLue ?? "(absente)"}, exigé 2.8.2.103375 exactement.`,
    );
    this.name = "VersionRefuseeError";
  }
}

/** Ramène les clés featherbear (points) vers la forme ucmix (barres). */
export function normaliserChemin(chemin: string): string {
  const brut = chemin.trim();
  if (brut.length === 0 || brut.includes("..") || brut.includes("\\") || brut.startsWith("/")) {
    throw new CheminRefuseError(chemin, "chemin mal formé");
  }
  return brut.replaceAll(".", "/");
}

export function estFragmentInterdit(chemin: string): boolean {
  const bas = chemin.toLowerCase();
  return FRAGMENTS_INTERDITS.some((fragment) => bas.includes(fragment));
}

export function estCheminAutorise(chemin: string): boolean {
  let normalise: string;
  try {
    normalise = normaliserChemin(chemin);
  } catch {
    return false;
  }
  if (estFragmentInterdit(normalise)) return false;
  const correspondance = /^line\/ch(\d+)\/(.+)$/.exec(normalise);
  if (!correspondance) return false;
  const canal = Number(correspondance[1]);
  const suffixe = correspondance[2];
  if (!Number.isInteger(canal) || canal < CANAL_MIN || canal > CANAL_MAX) return false;
  if (suffixe === undefined) return false;
  return SUFFIXES_AUTORISES.has(suffixe);
}

export function assertCheminAutorise(chemin: string): string {
  const normalise = normaliserChemin(chemin);
  if (estFragmentInterdit(normalise) || !estCheminAutorise(normalise)) {
    throw new CheminRefuseError(chemin, "hors liste blanche");
  }
  return normalise;
}

export function cheminVolume(canal: number): string {
  return `line/ch${canal}/volume`;
}

export function cheminPreamp(canal: number): string {
  return `line/ch${canal}/preampgain`;
}

export function cheminCanal(canal: number, suffixe: string): string {
  return `line/ch${canal}/${suffixe}`;
}

/** Clés dont l'égalité avant/après prouve que l'AVB, l'horloge, le 48 V et les scènes n'ont pas bougé. */
export function estCleSensible(chemin: string): boolean {
  return estFragmentInterdit(chemin);
}

export function suffixesAutorises(): readonly string[] {
  return [...SUFFIXES_AUTORISES];
}
