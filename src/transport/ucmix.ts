import dgram from "node:dgram";
import net from "node:net";
import { PORT_CONTROLE } from "../constantes.js";
import { decoderNiveaux, GROUPE_METRE_ENTREE } from "../metres.js";
import { assertPortControle, assertPortMesure } from "../ports.js";
import {
  AssembleurCk,
  decoderCk,
  decoderPs,
  decoderPv,
  encoderHelloMesure,
  encoderJson,
  encoderPv,
  encoderTrame,
  extraireTrame,
} from "../trames.js";
import { decoderInstantaneZb } from "../ubjson.js";
import type { Changement, OptionsConnexion, TransportConsole } from "./types.js";

/**
 * Repli en processus : client UCNET persistant, le même cadrage que
 * steveclarke/ucmix. Pas de spawn du CLI dans la boucle de contrôle.
 * Les commandes JSON autres que l'abonnement sont refusées par encoderJson.
 */
export class TransportUcmix implements TransportConsole {
  readonly nom = "ucmix" as const;
  private socket: net.Socket | undefined;
  private mesure: dgram.Socket | undefined;
  private maintien: NodeJS.Timeout | undefined;
  private tampon = Buffer.alloc(0);
  private readonly etat = new Map<string, number | boolean | string>();
  private readonly auditeurs = new Set<(changement: Changement) => void>();
  private readonly assembleur = new AssembleurCk();
  private metres = new Map<number, number>();
  private priseConnue = false;
  private attenteInstantane: ((erreur?: Error) => void) | undefined;

  async connecter(options: OptionsConnexion): Promise<void> {
    const port = options.port ?? PORT_CONTROLE;
    assertPortControle(port);
    await new Promise<void>((resoudre, rejeter) => {
      const socket = net.connect({ host: options.hote, port }, () => {
        socket.write(encoderTrame("JM", encoderJson(abonnement())));
      });
      this.socket = socket;
      const echec = (erreur: Error) => {
        socket.destroy();
        rejeter(erreur);
      };
      socket.once("error", echec);
      this.attenteInstantane = (erreur) => {
        socket.off("error", echec);
        if (erreur) echec(erreur);
        else resoudre();
      };
      socket.on("data", (morceau) => this.recevoir(morceau));
      socket.on("close", () => {
        this.attenteInstantane?.(new Error("ucmix : connexion fermée avant l'instantané"));
      });
    });
    this.maintien = setInterval(() => {
      this.socket?.write(encoderTrame("KA", Buffer.alloc(0)));
    }, 1000);
  }

  async fermer(): Promise<void> {
    if (this.maintien) clearInterval(this.maintien);
    this.maintien = undefined;
    this.mesure?.close();
    this.mesure = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket === undefined) return;
    await new Promise<void>((resoudre) => {
      socket.end(() => resoudre());
      socket.destroy();
    });
  }

  async lire(chemin: string): Promise<number | boolean | string | undefined> {
    return this.etat.get(chemin.replaceAll(".", "/"));
  }

  async instantane(): Promise<ReadonlyMap<string, number | boolean | string>> {
    return new Map(this.etat);
  }

  async lireVersion(): Promise<string | undefined> {
    const valeur = await this.lire("global/mixer_version");
    return valeur === undefined ? undefined : String(valeur);
  }

  async ecrire(chemin: string, valeur: number | boolean): Promise<void> {
    const socket = this.socket;
    if (socket === undefined) throw new Error("ucmix non connecté");
    const fil = typeof valeur === "boolean" ? (valeur ? 1 : 0) : valeur;
    await new Promise<void>((resoudre, rejeter) => {
      socket.write(encoderTrame("PV", encoderPv(chemin, fil)), (erreur) => {
        if (erreur) rejeter(erreur);
        else resoudre();
      });
    });
    this.etat.set(chemin, valeur);
    this.emettre({ chemin, valeur, origine: "service" });
  }

  async activerMesure(): Promise<void> {
    if (this.socket === undefined) throw new Error("ucmix non connecté");
    const udp = dgram.createSocket("udp4");
    await new Promise<void>((resoudre) => {
      udp.bind(0, () => resoudre());
    });
    const adresse = udp.address();
    assertPortMesure(adresse.port);
    udp.on("message", (message) => {
      const groupes = decoderNiveaux(message);
      const entree = groupes?.find((groupe) => groupe.groupe === GROUPE_METRE_ENTREE);
      if (entree === undefined) {
        this.priseConnue = false;
        return;
      }
      this.priseConnue = true;
      entree.valeurs.forEach((valeur, index) => {
        this.metres.set(index + 1, valeur);
      });
    });
    this.mesure = udp;
    this.socket.write(encoderHelloMesure(adresse.port));
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

  private recevoir(morceau: Buffer): void {
    this.tampon = Buffer.concat([this.tampon, morceau]);
    for (;;) {
      const extrait = extraireTrame(this.tampon);
      if (extrait === undefined) return;
      this.tampon = Buffer.from(extrait.reste);
      this.appliquer(extrait.trame.code, extrait.trame.charge);
    }
  }

  private appliquer(code: string, charge: Buffer): void {
    switch (code) {
      case "PV": {
        const decode = decoderPv(charge);
        this.etat.set(decode.cle, decode.valeur);
        this.emettre({ chemin: decode.cle, valeur: decode.valeur, origine: "externe" });
        return;
      }
      case "PS": {
        const decode = decoderPs(charge);
        this.etat.set(decode.cle, decode.valeur);
        return;
      }
      case "ZB":
        this.chargerInstantane(charge);
        return;
      case "CK": {
        const complet = this.assembleur.ajouter(decoderCk(charge));
        if (complet) this.chargerInstantane(complet);
        return;
      }
      default:
        return;
    }
  }

  private chargerInstantane(charge: Buffer): void {
    try {
      const plat = decoderInstantaneZb(charge);
      this.etat.clear();
      for (const [cle, valeur] of plat) {
        if (typeof valeur === "number" || typeof valeur === "string" || typeof valeur === "boolean") {
          this.etat.set(cle, valeur);
        } else if (typeof valeur === "bigint") {
          this.etat.set(cle, Number(valeur));
        }
      }
      this.attenteInstantane?.();
      this.attenteInstantane = undefined;
    } catch (erreur) {
      const motif = erreur instanceof Error ? erreur : new Error(String(erreur));
      this.attenteInstantane?.(motif);
      this.attenteInstantane = undefined;
    }
  }

  private emettre(changement: Changement): void {
    for (const auditeur of this.auditeurs) auditeur(changement);
  }
}

function abonnement(): { id: string } & Record<string, string | number> {
  return {
    id: "Subscribe",
    clientName: "Automixer",
    clientInternalName: "automixer-studiolive-32sc",
    clientType: "StudioLive API",
    clientDescription: "Automixer parole local",
    clientIdentifier: "4175746f6d69786572",
    clientOptions: "perm users levl redu rtan",
    clientEncoding: 23106,
  };
}
