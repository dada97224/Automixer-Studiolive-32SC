import { ATTENUATION_MAX_DB, LISSAGE_MS, SEUIL_OUVERTURE_DB, ZONE_MORTE_DB } from "./constantes.js";

export interface OptionsDugan {
  attenuationMaxDb?: number;
  zoneMorteDb?: number;
  lissageMs?: number;
  seuilOuvertureDb?: number;
}

export interface CanalDugan {
  id: string;
  niveauDb: number;
  nominalDb: number;
  gele: boolean;
}

export interface EcritureFader {
  id: string;
  faderDb: number;
}

export interface ResultatDugan {
  tenu: string | null;
  offsetsDb: Readonly<Record<string, number>>;
  fadersDb: Readonly<Record<string, number>>;
  ecritures: readonly EcritureFader[];
}

interface OptionsResolues {
  attenuationMaxDb: number;
  zoneMorteDb: number;
  lissageMs: number;
  seuilOuvertureDb: number;
}

/**
 * Partage de gain type Dugan : la somme des gains linéaires (puissance) reste 1
 * parmi les micros ouverts. Deux voix égales donnent chacune environ -3 dB.
 * Le décalage est borné à -attenuationMaxDb sous le nominal, jamais au-dessus.
 */
export function offsetsPartage(
  canaux: readonly CanalDugan[],
  tenu: string | null,
  options: OptionsResolues,
): { offsets: Map<string, number>; tenu: string | null } {
  const offsets = new Map<string, number>();
  const ouverts = canaux.filter(
    (canal) => !canal.gele && canal.niveauDb >= options.seuilOuvertureDb,
  );

  if (ouverts.length === 0) {
    const tenuToujoursLa = tenu !== null && canaux.some((canal) => canal.id === tenu && !canal.gele);
    for (const canal of canaux) {
      if (canal.gele) continue;
      const offset = tenuToujoursLa && canal.id === tenu ? 0 : -options.attenuationMaxDb;
      offsets.set(canal.id, offset);
    }
    return { offsets, tenu: tenuToujoursLa ? tenu : null };
  }

  let somme = 0;
  const puissances = new Map<string, number>();
  for (const canal of ouverts) {
    const puissance = 10 ** (canal.niveauDb / 10);
    puissances.set(canal.id, puissance);
    somme += puissance;
  }

  let plusFort: CanalDugan | undefined;
  for (const canal of ouverts) {
    if (plusFort === undefined || canal.niveauDb > plusFort.niveauDb) plusFort = canal;
  }

  for (const canal of canaux) {
    if (canal.gele) continue;
    const puissance = puissances.get(canal.id);
    if (puissance === undefined || somme <= 0) {
      offsets.set(canal.id, -options.attenuationMaxDb);
      continue;
    }
    const brut = 10 * Math.log10(puissance / somme);
    offsets.set(canal.id, Math.max(brut, -options.attenuationMaxDb));
  }

  return { offsets, tenu: plusFort?.id ?? null };
}

/** Lissage du premier ordre. tau <= 0 : la cible est atteinte tout de suite. */
export function lisser(precedent: number, cible: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0 || dtMs <= 0) return cible;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return precedent + (cible - precedent) * alpha;
}

export function doitEcrire(dernierDb: number, suivantDb: number, zoneMorteDb: number): boolean {
  return Math.abs(suivantDb - dernierDb) >= zoneMorteDb;
}

export class MoteurDugan {
  private readonly options: OptionsResolues;
  private readonly lisse = new Map<string, number>();
  private readonly dernierEcrit = new Map<string, number>();
  private tenu: string | null = null;

  constructor(options: OptionsDugan = {}) {
    this.options = {
      attenuationMaxDb: options.attenuationMaxDb ?? ATTENUATION_MAX_DB,
      zoneMorteDb: options.zoneMorteDb ?? ZONE_MORTE_DB,
      lissageMs: options.lissageMs ?? LISSAGE_MS,
      seuilOuvertureDb: options.seuilOuvertureDb ?? SEUIL_OUVERTURE_DB,
    };
  }

  reinitialiser(): void {
    this.lisse.clear();
    this.dernierEcrit.clear();
    this.tenu = null;
  }

  tick(canaux: readonly CanalDugan[], dtMs: number): ResultatDugan {
    const partage = offsetsPartage(canaux, this.tenu, this.options);
    this.tenu = partage.tenu;
    const offsetsDb: Record<string, number> = {};
    const fadersDb: Record<string, number> = {};
    const ecritures: EcritureFader[] = [];

    for (const canal of canaux) {
      if (canal.gele) continue;
      const offsetCible = partage.offsets.get(canal.id) ?? -this.options.attenuationMaxDb;
      const precedent = this.lisse.get(canal.id) ?? 0;
      const offset = lisser(precedent, offsetCible, dtMs, this.options.lissageMs);
      this.lisse.set(canal.id, offset);
      const borneBasse = canal.nominalDb - this.options.attenuationMaxDb;
      const fader = Math.min(canal.nominalDb, Math.max(borneBasse, canal.nominalDb + offset));
      offsetsDb[canal.id] = fader - canal.nominalDb;
      fadersDb[canal.id] = fader;
      const dernier = this.dernierEcrit.get(canal.id) ?? canal.nominalDb;
      if (doitEcrire(dernier, fader, this.options.zoneMorteDb)) {
        this.dernierEcrit.set(canal.id, fader);
        ecritures.push({ id: canal.id, faderDb: fader });
      }
    }

    return { tenu: this.tenu, offsetsDb, fadersDb, ecritures };
  }
}
