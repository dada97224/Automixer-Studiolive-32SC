import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PORT_CONTROLE, PORT_HTTP, VERSION_FIRMWARE_EXIGEE } from "./constantes.js";
import { comparerSensibles, extraireSensibles, validerEtat } from "./dump.js";
import { GardeEcriture } from "./garde.js";
import { JournalFichier } from "./journal.js";
import { demarrerHttp } from "./http.js";
import { ServiceAutomixer } from "./service.js";
import { ouvrirTransport } from "./transport/selection.js";

type Commande = "dump" | "servir" | "panique";

function estCommande(valeur: string): valeur is Commande {
  switch (valeur) {
    case "dump":
    case "servir":
    case "panique":
      return true;
    default:
      return false;
  }
}

async function main(): Promise<void> {
  const [brut, ...reste] = process.argv.slice(2);
  if (brut === undefined || !estCommande(brut)) {
    process.stderr.write(
      `Automixer StudioLive 32 SC — firmware figé ${VERSION_FIRMWARE_EXIGEE}\n` +
        "Usage : tsx src/cli.ts dump|servir|panique --hote <ip> [--sortie fichier.json]\n" +
        "Ne met pas à jour le firmware. N'ouvre pas les ports AVB. TCP 53000 seulement.\n",
    );
    process.exitCode = 1;
    return;
  }
  const commande: Commande = brut;
  const hote = argument(reste, "--hote");
  if (hote === undefined) throw new Error("--hote requis");
  const ouvert = await ouvrirTransport({ hote, port: PORT_CONTROLE });
  const journal = new JournalFichier(path.join("data", "journal.jsonl"));
  const garde = new GardeEcriture(ouvert.transport, journal);
  const service = new ServiceAutomixer(garde, ouvert.transport);

  switch (commande) {
    case "dump": {
      const etat = await ouvert.transport.instantane();
      const metres = ouvert.transport.lireMetresBruts();
      const rapport = validerEtat(etat, metres?.priseConnue ? [0] : []);
      const sensibles = Object.fromEntries(extraireSensibles(etat));
      const texte = JSON.stringify(
        {
          transport: ouvert.transport.nom,
          basculeUcmix: ouvert.bascule,
          rapport,
          sensibles,
        },
        null,
        2,
      );
      const sortie = argument(reste, "--sortie");
      if (sortie !== undefined) {
        mkdirSync(path.dirname(sortie), { recursive: true });
        writeFileSync(sortie, texte, "utf8");
      }
      process.stdout.write(`${texte}\n`);
      const reference = argument(reste, "--comparer");
      if (reference !== undefined) {
        const avant = chargerSensibles(reference);
        const diff = comparerSensibles(avant, etat);
        process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
        if (!diff.identique) process.exitCode = 2;
      }
      break;
    }
    case "servir": {
      await ouvert.transport.activerMesure();
      const http = await demarrerHttp({
        service,
        journal,
        port: PORT_HTTP,
        fichierNominaux: path.join("data", "nominaux.json"),
      });
      process.stdout.write(
        `HTTP ${http.url} — transport ${ouvert.transport.nom}. Ctrl+C pour quitter. Aucune mise à jour firmware.\n`,
      );
      await new Promise<void>((resoudre) => {
        process.once("SIGINT", () => resoudre());
        process.once("SIGTERM", () => resoudre());
      });
      service.arreter();
      await http.fermer();
      break;
    }
    case "panique": {
      const fichier = path.join("data", "nominaux.json");
      const nominaux = JSON.parse(readFileSync(fichier, "utf8")) as { canal: number; nominalDb: number }[];
      service.armer(nominaux);
      await service.paniquer();
      process.stdout.write("Nominaux restaurés.\n");
      break;
    }
    default: {
      const _exhaustif: never = commande;
      throw new Error(`commande inattendue ${_exhaustif}`);
    }
  }
  await ouvert.transport.fermer();
}

function chargerSensibles(fichier: string): Map<string, number | boolean | string> {
  const json = JSON.parse(readFileSync(fichier, "utf8")) as {
    sensibles?: Record<string, number | boolean | string>;
  } & Record<string, number | boolean | string>;
  const source = json.sensibles ?? json;
  return new Map(Object.entries(source));
}

function argument(args: string[], nom: string): string | undefined {
  const index = args.indexOf(nom);
  if (index < 0) return undefined;
  return args[index + 1];
}

main().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
