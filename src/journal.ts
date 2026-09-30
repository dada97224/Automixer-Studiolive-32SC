import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface EntreeJournal {
  horodatage: string;
  chemin: string;
  valeur: number | boolean | string;
  motif: string;
}

export interface Journal {
  ajouter(entree: Omit<EntreeJournal, "horodatage">): EntreeJournal;
  lire(): readonly EntreeJournal[];
}

export class JournalMemoire implements Journal {
  private readonly entrees: EntreeJournal[] = [];

  ajouter(entree: Omit<EntreeJournal, "horodatage">): EntreeJournal {
    const complete: EntreeJournal = {
      horodatage: new Date().toISOString(),
      ...entree,
    };
    this.entrees.push(complete);
    return complete;
  }

  lire(): readonly EntreeJournal[] {
    return this.entrees;
  }
}

export class JournalFichier implements Journal {
  private readonly memoire = new JournalMemoire();

  constructor(private readonly fichier: string) {
    mkdirSync(path.dirname(fichier), { recursive: true });
  }

  ajouter(entree: Omit<EntreeJournal, "horodatage">): EntreeJournal {
    const complete = this.memoire.ajouter(entree);
    appendFileSync(this.fichier, `${JSON.stringify(complete)}\n`, "utf8");
    return complete;
  }

  lire(): readonly EntreeJournal[] {
    return this.memoire.lire();
  }
}
