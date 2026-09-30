import type { Changement, OptionsConnexion, TransportConsole } from "./types.js";

/**
 * Console en mémoire. Les déplacements externes simulent un geste
 * que le service n'a pas écrit (fader touché, ou écho absent).
 */
export class TransportFictif implements TransportConsole {
  readonly nom = "fictif" as const;
  readonly ecritures: { chemin: string; valeur: number | boolean }[] = [];
  private readonly etat = new Map<string, number | boolean | string>();
  private readonly auditeurs = new Set<(changement: Changement) => void>();
  private metres = new Map<number, number>();
  private connecte = false;

  constructor(version = "2.8.2.103375") {
    this.etat.set("global/mixer_version", version);
  }

  definir(chemin: string, valeur: number | boolean | string): void {
    this.etat.set(chemin, valeur);
  }

  async connecter(_options: OptionsConnexion): Promise<void> {
    this.connecte = true;
  }

  async fermer(): Promise<void> {
    this.connecte = false;
  }

  async lire(chemin: string): Promise<number | boolean | string | undefined> {
    this.assertConnecte();
    return this.etat.get(chemin);
  }

  async instantane(): Promise<ReadonlyMap<string, number | boolean | string>> {
    this.assertConnecte();
    return new Map(this.etat);
  }

  async lireVersion(): Promise<string | undefined> {
    const valeur = this.etat.get("global/mixer_version");
    return valeur === undefined ? undefined : String(valeur);
  }

  async ecrire(chemin: string, valeur: number | boolean): Promise<void> {
    this.assertConnecte();
    this.etat.set(chemin, valeur);
    this.ecritures.push({ chemin, valeur });
    this.emettre({ chemin, valeur, origine: "service" });
  }

  deplacerExterieur(chemin: string, valeur: number | boolean | string): void {
    this.etat.set(chemin, valeur);
    this.emettre({ chemin, valeur, origine: "externe" });
  }

  definirMetres(canaux: ReadonlyMap<number, number>): void {
    this.metres = new Map(canaux);
  }

  async activerMesure(): Promise<void> {
    this.assertConnecte();
  }

  surChangement(auditeur: (changement: Changement) => void): () => void {
    this.auditeurs.add(auditeur);
    return () => {
      this.auditeurs.delete(auditeur);
    };
  }

  lireMetresBruts(): { priseConnue: boolean; valeurs: ReadonlyMap<number, number> } {
    return { priseConnue: true, valeurs: this.metres };
  }

  private emettre(changement: Changement): void {
    for (const auditeur of this.auditeurs) auditeur(changement);
  }

  private assertConnecte(): void {
    if (!this.connecte) throw new Error("transport fictif non connecté");
  }
}
