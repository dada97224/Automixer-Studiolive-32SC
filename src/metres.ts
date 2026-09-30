/**
 * Groupe 0x0000 : « input signal » dans featherbear. On le traite comme
 * pré-fader, car il est pris à l'entrée, avant le fader.
 * Si ce groupe est absent, la prise est incertaine et on compense par
 * le gain de fader déjà appliqué.
 */
export const GROUPE_METRE_ENTREE = 0x0000;

export type PriseMetre = "pre-fader" | "post-fader" | "non-mesure";

export function choisirPriseMetre(groupesPresents: readonly number[]): PriseMetre {
  if (groupesPresents.length === 0) return "non-mesure";
  if (groupesPresents.includes(GROUPE_METRE_ENTREE)) return "pre-fader";
  return "post-fader";
}

/**
 * Un mètre post-fader inclut déjà le gain du fader.
 * On le retire pour que l'automixer voie le niveau d'entrée.
 */
export function niveauPourAutomix(
  metreDb: number,
  faderDb: number,
  prise: Exclude<PriseMetre, "non-mesure">,
): number {
  if (prise === "pre-fader") return metreDb;
  return metreDb - faderDb;
}

export interface DescripteurMetre {
  groupe: number;
  valeurs: readonly number[];
}

/** Décodage du bloc « levl » UDP, d'après MeterServer de featherbear. */
export function decoderNiveaux(paquet: Buffer): DescripteurMetre[] | undefined {
  if (paquet.length < 21) return undefined;
  if (paquet.subarray(6, 8).toString("ascii") !== "MS") return undefined;
  if (paquet.subarray(12, 16).toString("ascii") !== "levl") return undefined;
  const nombreValeurs = paquet.readUInt16LE(18);
  const valeurs: number[] = [];
  for (let i = 0; i < nombreValeurs; i += 1) {
    valeurs.push(paquet.readUInt16LE(20 + i * 2));
  }
  const descripteurs = paquet[20 + nombreValeurs * 2];
  if (descripteurs === undefined) return undefined;
  const attendu = 21 + nombreValeurs * 2 + descripteurs * 6;
  if (attendu !== paquet.length) return undefined;
  const sortie: DescripteurMetre[] = [];
  for (let i = 0; i < descripteurs; i += 1) {
    const offsetDesc = 21 + nombreValeurs * 2 + i * 6;
    const groupe = paquet.readInt16BE(offsetDesc);
    const offset = paquet.readInt16LE(offsetDesc + 2);
    const compte = paquet.readInt16LE(offsetDesc + 4);
    sortie.push({ groupe, valeurs: valeurs.slice(offset, offset + compte) });
  }
  return sortie;
}
