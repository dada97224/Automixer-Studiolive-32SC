import { VERSION_FIRMWARE_EXIGEE } from "./constantes.js";
import {
  assertCheminAutorise,
  CheminRefuseError,
  VersionRefuseeError,
} from "./chemins.js";
import type { Journal } from "./journal.js";
import type { TransportConsole } from "./transport/types.js";

export interface ContexteEcriture {
  /** Vrai seulement après confirmerTrim, et jamais pendant l'automix. */
  trimConfirme?: boolean;
}

/**
 * Toute écriture passe ici : version exacte, liste blanche, journal.
 * Le transport fictif n'est pas une exception.
 */
export class GardeEcriture {
  automixActif = false;

  constructor(
    private readonly transport: TransportConsole,
    private readonly journal: Journal,
    private readonly versionExigee = VERSION_FIRMWARE_EXIGEE,
  ) {}

  async lireVersion(): Promise<string | undefined> {
    const valeur = await this.transport.lireVersion();
    return valeur === undefined ? undefined : String(valeur);
  }

  async verifierVersion(): Promise<void> {
    const version = await this.lireVersion();
    if (version !== this.versionExigee) {
      throw new VersionRefuseeError(version);
    }
  }

  async ecrire(
    chemin: string,
    valeur: number | boolean,
    motif: string,
    contexte: ContexteEcriture = {},
  ): Promise<void> {
    await this.verifierVersion();
    const normalise = assertCheminAutorise(chemin);
    if (normalise.endsWith("/preampgain")) {
      if (this.automixActif) {
        throw new CheminRefuseError(normalise, "trim interdit pendant l'automix");
      }
      if (contexte.trimConfirme !== true || motif !== "trim-confirme") {
        throw new CheminRefuseError(normalise, "trim sans confirmation explicite");
      }
    }
    await this.transport.ecrire(normalise, valeur);
    this.journal.ajouter({ chemin: normalise, valeur, motif });
  }
}
