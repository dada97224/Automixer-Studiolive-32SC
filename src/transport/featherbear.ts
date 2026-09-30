import { createRequire } from "node:module";
import { assertPortControle, assertPortMesure } from "../ports.js";
import { PORT_CONTROLE } from "../constantes.js";
import { decoderNiveaux, GROUPE_METRE_ENTREE } from "../metres.js";
import { encoderPv } from "../trames.js";
import type { Changement, OptionsConnexion, TransportConsole } from "./types.js";

interface ClientFeatherbear {
  connect(options?: { clientDescription?: string }): Promise<unknown>;
  close(): Promise<void>;
  state: { get(cle: string): unknown };
  meterSubscribe(port?: number): Promise<{ address(): { port: number } } | null>;
  meterUnsubscribe(): void;
  on(evenement: string, auditeur: (donnees: unknown) => void): void;
  _sendPacket(code: string, charge: Buffer): Promise<unknown>;
}

interface ModuleFeatherbear {
  Client: new (adresse: { host: string; port: number }) => ClientFeatherbear;
}

const require = createRequire(import.meta.url);

/**
 * Transport par défaut. La bibliothèque ne publie pas d'écriture générique :
 * on réutilise son socket via _sendPacket et une charge PV déjà cadrée.
 * Si cette voie échoue au branchement, la sélection bascule sur ucmix.
 */
export class TransportFeatherbear implements TransportConsole {
  readonly nom = "featherbear" as const;
  private client: ClientFeatherbear | undefined;
  private readonly cache = new Map<string, number | boolean | string>();
  private readonly auditeurs = new Set<(changement: Changement) => void>();
  private metres = new Map<number, number>();
  private priseConnue = false;

  async connecter(options: OptionsConnexion): Promise<void> {
    const port = options.port ?? PORT_CONTROLE;
    assertPortControle(port);
    const module = chargerModule();
    this.client = new module.Client({ host: options.hote, port });
    this.client.on("PV", (donnees) => {
      const recu = donnees as { name?: string; value?: number };
      if (recu.name === undefined || typeof recu.value !== "number") return;
      const chemin = recu.name.replaceAll(".", "/");
      this.cache.set(chemin, recu.value);
      this.emettre({ chemin, valeur: recu.value, origine: "externe" });
    });
    this.client.on("PS", (donnees) => {
      const recu = donnees as { name?: string; value?: string };
      if (recu.name === undefined || typeof recu.value !== "string") return;
      this.cache.set(recu.name.replaceAll(".", "/"), recu.value);
    });
    this.client.on("meter", (donnees) => {
      this.integrerMetres(donnees);
    });
    await this.client.connect({ clientDescription: "Automixer StudioLive 32SC" });
  }

  async fermer(): Promise<void> {
    this.client?.meterUnsubscribe();
    await this.client?.close();
    this.client = undefined;
  }

  async lire(chemin: string): Promise<number | boolean | string | undefined> {
    const client = this.clientObligatoire();
    for (const cle of variantes(chemin)) {
      const valeur = client.state.get(cle);
      if (estValeur(valeur)) return valeur;
    }
    return this.cache.get(chemin.replaceAll(".", "/"));
  }

  async instantane(): Promise<ReadonlyMap<string, number | boolean | string>> {
    const client = this.clientObligatoire();
    const sortie = new Map(this.cache);
    const avecDump = client as ClientFeatherbear & {
      dumpState?: () => { cache?: unknown; internal?: unknown };
    };
    const dump = avecDump.dumpState?.();
    collecter(dump?.cache, "", sortie);
    collecter(dump?.internal, "", sortie);
    return sortie;
  }

  async lireVersion(): Promise<string | undefined> {
    const valeur = await this.lire("global/mixer_version");
    return valeur === undefined ? undefined : String(valeur);
  }

  async ecrire(chemin: string, valeur: number | boolean): Promise<void> {
    const client = this.clientObligatoire();
    const fil = typeof valeur === "boolean" ? (valeur ? 1 : 0) : valeur;
    await client._sendPacket("PV", encoderPv(chemin, fil));
    this.cache.set(chemin, valeur);
    this.emettre({ chemin, valeur, origine: "service" });
  }

  async activerMesure(): Promise<void> {
    const client = this.clientObligatoire();
    const socket = await client.meterSubscribe(0);
    const port = socket?.address().port;
    if (port === undefined) throw new Error("mesure UDP indisponible");
    assertPortMesure(port);
  }

  surChangement(auditeur: (changement: Changement) => void): () => void {
    this.auditeurs.add(auditeur);
    return () => {
      this.auditeurs.delete(auditeur);
    };
  }

  lireMetresBruts(): { priseConnue: boolean; valeurs: ReadonlyMap<number, number> } {
    return { priseConnue: this.priseConnue, valeurs: this.metres };
  }

  private integrerMetres(donnees: unknown): void {
    if (Buffer.isBuffer(donnees)) {
      const groupes = decoderNiveaux(donnees);
      if (groupes === undefined) return;
      const entree = groupes.find((groupe) => groupe.groupe === GROUPE_METRE_ENTREE);
      if (entree === undefined) {
        this.priseConnue = false;
        return;
      }
      this.priseConnue = true;
      entree.valeurs.forEach((valeur, index) => {
        this.metres.set(index + 1, valeur);
      });
      return;
    }
    if (typeof donnees !== "object" || donnees === null) return;
    const enregistrement = donnees as Record<string, unknown>;
    const entree = enregistrement[String(GROUPE_METRE_ENTREE)] ?? enregistrement[GROUPE_METRE_ENTREE];
    if (!Array.isArray(entree)) {
      this.priseConnue = false;
      return;
    }
    this.priseConnue = true;
    entree.forEach((valeur, index) => {
      if (typeof valeur === "number") this.metres.set(index + 1, valeur);
    });
  }

  private clientObligatoire(): ClientFeatherbear {
    if (this.client === undefined) throw new Error("featherbear non connecté");
    return this.client;
  }

  private emettre(changement: Changement): void {
    for (const auditeur of this.auditeurs) auditeur(changement);
  }
}

function chargerModule(): ModuleFeatherbear {
  const module = require("@featherbear/presonus-studiolive-api") as ModuleFeatherbear;
  if (typeof module.Client !== "function") {
    throw new Error("Client featherbear introuvable");
  }
  return module;
}

function variantes(chemin: string): string[] {
  const barre = chemin.replaceAll(".", "/");
  const point = barre.replaceAll("/", ".");
  return barre === point ? [barre] : [barre, point];
}

function collecter(
  noeud: unknown,
  prefixe: string,
  sortie: Map<string, number | boolean | string>,
): void {
  if (!estValeur(noeud) && (typeof noeud !== "object" || noeud === null)) return;
  if (estValeur(noeud)) {
    if (prefixe.length > 0) sortie.set(prefixe.replaceAll(".", "/"), noeud);
    return;
  }
  if (Array.isArray(noeud)) return;
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (cle === "children" || cle === "values") {
      collecter(valeur, prefixe, sortie);
      continue;
    }
    const chemin = prefixe.length === 0 ? cle : `${prefixe}/${cle}`;
    collecter(valeur, chemin, sortie);
  }
}

function estValeur(valeur: unknown): valeur is number | boolean | string {
  const type = typeof valeur;
  return type === "number" || type === "boolean" || type === "string";
}
