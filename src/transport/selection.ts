import type { OptionsConnexion, TransportConsole } from "./types.js";
import { TransportFeatherbear } from "./featherbear.js";
import { TransportUcmix } from "./ucmix.js";

export interface TransportOuvert {
  transport: TransportConsole;
  bascule: boolean;
  erreurs: readonly string[];
}

/**
 * featherbear d'abord. S'il ne joint pas la console ou ne lit pas la version,
 * on ouvre un client ucmix persistant. Jamais le CLI.
 */
export async function ouvrirTransport(options: OptionsConnexion): Promise<TransportOuvert> {
  const erreurs: string[] = [];
  try {
    const featherbear = new TransportFeatherbear();
    await featherbear.connecter(options);
    const version = await featherbear.lireVersion();
    if (version === undefined) {
      await featherbear.fermer();
      throw new Error("featherbear connecté mais global.mixer_version illisible");
    }
    return { transport: featherbear, bascule: false, erreurs };
  } catch (erreur) {
    erreurs.push(message(erreur));
  }

  try {
    const ucmix = new TransportUcmix();
    await ucmix.connecter(options);
    return { transport: ucmix, bascule: true, erreurs };
  } catch (erreur) {
    erreurs.push(message(erreur));
    throw new Error(`Aucun transport disponible. ${erreurs.join(" | ")}`);
  }
}

function message(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}
