import { ZONE_MORTE_DB } from "./constantes.js";
import { cheminCanal, cheminPreamp, cheminVolume } from "./chemins.js";
import { faderDbVersFil, faderFilVersDb, normaliserFilVolume, type PointCalibration } from "./courbes.js";
import { MoteurDugan, type OptionsDugan } from "./dugan.js";
import type { GardeEcriture } from "./garde.js";
import { niveauPourAutomix, type PriseMetre } from "./metres.js";
import { ecrituresDuProfil, type Role } from "./profils.js";
import { confirmerTrim, suggererTrim, type SuggestionTrim } from "./trim.js";
import type { TransportConsole } from "./transport/types.js";

export interface CanalArme {
  canal: number;
  nominalDb: number;
}

export interface OptionsService {
  priseMetre?: Exclude<PriseMetre, "non-mesure">;
  loiMetreConfirmee?: boolean;
  dugan?: OptionsDugan;
}

/**
 * Pilote parole : nominaux opérateur, gel si le fader bouge sans nous,
 * panic vers ces nominaux. Les profils restent dans ce processus.
 */
export class ServiceAutomixer {
  private readonly moteur: MoteurDugan;
  private readonly nominaux = new Map<number, number>();
  private readonly geles = new Set<number>();
  private readonly derniersFils = new Map<string, number>();
  private suggestion: SuggestionTrim | undefined;
  private actif = false;
  private minuteur: NodeJS.Timeout | undefined;

  constructor(
    private readonly garde: GardeEcriture,
    private readonly transport: TransportConsole,
    private readonly options: OptionsService = {},
  ) {
    this.moteur = new MoteurDugan(options.dugan);
    this.transport.surChangement((changement) => {
      this.observerFader(changement.chemin, changement.valeur, changement.origine);
    });
  }

  get automixActif(): boolean {
    return this.actif;
  }

  estGele(canal: number): boolean {
    return this.geles.has(canal);
  }

  armer(canaux: readonly CanalArme[]): void {
    for (const canal of canaux) {
      this.nominaux.set(canal.canal, canal.nominalDb);
    }
    this.moteur.reinitialiser();
  }

  async reglerFader(canal: number, db: number): Promise<void> {
    if (this.geles.has(canal)) {
      throw new Error(`canal ${canal} gelé : libérer le gel avant une écriture manuelle`);
    }
    await this.garde.ecrire(cheminVolume(canal), faderDbVersFil(db), "manuel");
    if (!this.nominaux.has(canal)) this.nominaux.set(canal, db);
  }

  async tick(niveauxDb: ReadonlyMap<number, number>, dtMs: number): Promise<void> {
    const canaux = [...this.nominaux.entries()].map(([canal, nominalDb]) => ({
      id: String(canal),
      niveauDb: niveauxDb.get(canal) ?? -120,
      nominalDb,
      gele: this.geles.has(canal),
    }));
    const resultat = this.moteur.tick(canaux, dtMs);
    for (const ecriture of resultat.ecritures) {
      const canal = Number(ecriture.id);
      if (this.geles.has(canal)) continue;
      await this.garde.ecrire(cheminVolume(canal), faderDbVersFil(ecriture.faderDb), "automix");
    }
  }

  /**
   * Boucle temps réel. Refusée tant que la loi du mètre n'a pas été
   * confirmée à l'oreille sur cette console : on n'invente pas de dB.
   */
  demarrerBoucle(
    lireNiveauDb: (brut: number, canal: number) => number,
    dtMs = 20,
  ): void {
    if (this.options.loiMetreConfirmee !== true) {
      throw new Error("Boucle refusée : confirmer la loi du mètre sur la console (voir le protocole d'essai).");
    }
    if (this.minuteur) return;
    this.actif = true;
    this.garde.automixActif = true;
    this.minuteur = setInterval(() => {
      void this.tickMetres(lireNiveauDb, dtMs);
    }, dtMs);
  }

  arreter(): void {
    this.actif = false;
    this.garde.automixActif = false;
    if (this.minuteur) clearInterval(this.minuteur);
    this.minuteur = undefined;
  }

  async paniquer(): Promise<void> {
    this.arreter();
    for (const [canal, nominal] of this.nominaux) {
      await this.garde.ecrire(cheminVolume(canal), faderDbVersFil(nominal), "panic");
    }
    this.geles.clear();
    this.moteur.reinitialiser();
  }

  libererGel(canal: number): void {
    this.geles.delete(canal);
  }

  async appliquerProfil(
    role: Role,
    canaux: readonly number[],
    calibrationRange?: readonly PointCalibration[],
  ): Promise<void> {
    const ecritures = ecrituresDuProfil(role, calibrationRange);
    for (const canal of canaux) {
      if (!this.nominaux.has(canal)) {
        throw new Error(`canal ${canal} hors du groupe parole armé`);
      }
      for (const ecriture of ecritures) {
        await this.garde.ecrire(
          cheminCanal(canal, ecriture.suffixe),
          ecriture.valeur,
          ecriture.motif,
        );
      }
    }
  }

  async proposerTrim(canal: number, metreDb: number, cibleDb?: number): Promise<SuggestionTrim> {
    const lu = await this.transport.lire(cheminPreamp(canal));
    const filActuel = typeof lu === "number" ? lu : 0;
    this.suggestion = suggererTrim({ canal, filActuel, metreDb, cibleDb });
    return this.suggestion;
  }

  async confirmerTrim(jeton: string): Promise<void> {
    const suggestion = this.suggestion;
    const fil = confirmerTrim({
      suggestion,
      jeton,
      automixActif: this.actif,
    });
    if (suggestion === undefined) return;
    await this.garde.ecrire(cheminPreamp(suggestion.canal), fil, "trim-confirme", {
      trimConfirme: true,
    });
    this.suggestion = undefined;
  }

  private async tickMetres(
    lireNiveauDb: (brut: number, canal: number) => number,
    dtMs: number,
  ): Promise<void> {
    const bruts = this.transport.lireMetresBruts();
    if (bruts === undefined) return;
    const prise = bruts.priseConnue ? (this.options.priseMetre ?? "pre-fader") : "post-fader";
    const niveaux = new Map<number, number>();
    for (const canal of this.nominaux.keys()) {
      const brut = bruts.valeurs.get(canal);
      if (brut === undefined) continue;
      const metreDb = lireNiveauDb(brut, canal);
      const nominal = this.nominaux.get(canal) ?? 0;
      niveaux.set(canal, niveauPourAutomix(metreDb, nominal, prise));
    }
    await this.tick(niveaux, dtMs);
  }

  private observerFader(
    chemin: string,
    valeur: number | boolean | string,
    origine: "service" | "externe",
  ): void {
    if (!chemin.endsWith("/volume") || typeof valeur !== "number") return;
    const fil = normaliserFilVolume(valeur);
    if (origine === "service") {
      this.derniersFils.set(chemin, fil);
      return;
    }
    const canal = Number(/ch(\d+)\//.exec(chemin)?.[1]);
    if (!Number.isInteger(canal)) return;
    const dernier = this.derniersFils.get(chemin);
    const reference =
      dernier !== undefined ? faderFilVersDb(dernier) : (this.nominaux.get(canal) ?? faderFilVersDb(fil));
    const observe = faderFilVersDb(fil);
    if (Math.abs(observe - reference) >= ZONE_MORTE_DB) {
      this.geles.add(canal);
    }
  }
}
