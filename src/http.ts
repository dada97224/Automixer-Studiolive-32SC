import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { HOTE_HTTP } from "./constantes.js";
import { estRole } from "./profils.js";
import type { ServiceAutomixer } from "./service.js";
import type { Journal } from "./journal.js";

export interface ServeurManuel {
  url: string;
  fermer(): Promise<void>;
}

/**
 * Réglage manuel sur localhost seulement. Pas d'écoute sur le réseau.
 */
export function demarrerHttp(params: {
  service: ServiceAutomixer;
  journal: Journal;
  port?: number;
  fichierNominaux?: string;
}): Promise<ServeurManuel> {
  const serveur = createServer((requete, reponse) => {
    void traiter(requete, reponse, params.service, params.journal, params.fichierNominaux);
  });
  const port = params.port ?? 0;
  return new Promise((resoudre, rejeter) => {
    serveur.once("error", rejeter);
    serveur.listen(port, HOTE_HTTP, () => {
      const adresse = serveur.address();
      if (adresse === null || typeof adresse === "string") {
        rejeter(new Error("adresse HTTP indisponible"));
        return;
      }
      resoudre({
        url: `http://${HOTE_HTTP}:${adresse.port}`,
        fermer: () =>
          new Promise((fini, echec) => {
            serveur.close((erreur) => (erreur ? echec(erreur) : fini()));
          }),
      });
    });
  });
}

async function traiter(
  requete: IncomingMessage,
  reponse: ServerResponse,
  service: ServiceAutomixer,
  journal: Journal,
  fichierNominaux: string | undefined,
): Promise<void> {
  try {
    const url = new URL(requete.url ?? "/", "http://127.0.0.1");
    if (requete.method === "GET" && url.pathname === "/etat") {
      return envoyer(reponse, 200, {
        automixActif: service.automixActif,
        journal: journal.lire(),
      });
    }
    if (requete.method === "GET" && url.pathname === "/journal") {
      return envoyer(reponse, 200, journal.lire());
    }
    const corps = await lireJson(requete);
    if (requete.method === "POST" && url.pathname === "/armer") {
      const canaux = tableauCanaux(corps);
      service.armer(canaux);
      if (fichierNominaux !== undefined) {
        mkdirSync(path.dirname(fichierNominaux), { recursive: true });
        writeFileSync(fichierNominaux, JSON.stringify(canaux), "utf8");
      }
      return envoyer(reponse, 200, { armes: canaux.length });
    }
    if (requete.method === "POST" && url.pathname === "/fader") {
      const canal = nombre(corps, "canal");
      const db = nombre(corps, "db");
      await service.reglerFader(canal, db);
      return envoyer(reponse, 200, { canal, db });
    }
    if (requete.method === "POST" && url.pathname === "/automix/tick") {
      const liste = corps.niveaux;
      if (!Array.isArray(liste)) throw new Error("niveaux attendus");
      const carte = new Map<number, number>();
      for (const entree of liste) {
        if (typeof entree !== "object" || entree === null) continue;
        const ligne = entree as Record<string, unknown>;
        carte.set(Number(ligne.canal), Number(ligne.niveauDb));
      }
      await service.tick(carte, nombre(corps, "dtMs"));
      return envoyer(reponse, 200, { ok: true });
    }
    if (requete.method === "POST" && url.pathname === "/panic") {
      await service.paniquer();
      return envoyer(reponse, 200, { ok: true });
    }
    if (requete.method === "POST" && url.pathname === "/gel/liberer") {
      service.libererGel(nombre(corps, "canal"));
      return envoyer(reponse, 200, { ok: true });
    }
    if (requete.method === "POST" && url.pathname === "/trim/suggestion") {
      const suggestion = await service.proposerTrim(
        nombre(corps, "canal"),
        nombre(corps, "metreDb"),
        corps.cibleDb === undefined ? undefined : nombre(corps, "cibleDb"),
      );
      return envoyer(reponse, 200, suggestion);
    }
    if (requete.method === "POST" && url.pathname === "/trim/confirmer") {
      const jeton = corps.jeton;
      if (typeof jeton !== "string") throw new Error("jeton manquant");
      await service.confirmerTrim(jeton);
      return envoyer(reponse, 200, { ok: true });
    }
    if (requete.method === "POST" && url.pathname === "/profil") {
      const role = corps.role;
      if (typeof role !== "string" || !estRole(role)) throw new Error("rôle inconnu");
      const canaux = corps.canaux;
      if (!Array.isArray(canaux) || !canaux.every((canal) => typeof canal === "number")) {
        throw new Error("canaux attendus");
      }
      await service.appliquerProfil(role, canaux);
      return envoyer(reponse, 200, { ok: true });
    }
    envoyer(reponse, 404, { erreur: "introuvable" });
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    envoyer(reponse, 400, { erreur: message });
  }
}

function tableauCanaux(corps: Record<string, unknown>): { canal: number; nominalDb: number }[] {
  if (!Array.isArray(corps.canaux)) throw new Error("canaux attendus");
  return corps.canaux.map((entree) => {
    if (typeof entree !== "object" || entree === null) throw new Error("canal invalide");
    const ligne = entree as Record<string, unknown>;
    return { canal: Number(ligne.canal), nominalDb: Number(ligne.nominalDb) };
  });
}

function nombre(corps: Record<string, unknown>, cle: string): number {
  const valeur = corps[cle];
  if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
    throw new Error(`${cle} numérique attendu`);
  }
  return valeur;
}

function envoyer(reponse: ServerResponse, statut: number, corps: unknown): void {
  const charge = JSON.stringify(corps);
  reponse.writeHead(statut, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(charge),
  });
  reponse.end(charge);
}

async function lireJson(requete: IncomingMessage): Promise<Record<string, unknown>> {
  if (requete.method === "GET") return {};
  const morceaux: Buffer[] = [];
  for await (const morceau of requete) {
    morceaux.push(Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau));
  }
  if (morceaux.length === 0) return {};
  const parse = JSON.parse(Buffer.concat(morceaux).toString("utf8")) as unknown;
  if (typeof parse !== "object" || parse === null || Array.isArray(parse)) {
    throw new Error("JSON objet attendu");
  }
  return parse as Record<string, unknown>;
}
