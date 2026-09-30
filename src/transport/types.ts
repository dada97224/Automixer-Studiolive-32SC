export type NomTransport = "fictif" | "featherbear" | "ucmix";

export type OrigineChangement = "service" | "externe";

export interface Changement {
  chemin: string;
  valeur: number | boolean | string;
  origine: OrigineChangement;
}

export interface OptionsConnexion {
  hote: string;
  /** Doit rester 53000. Toute autre valeur est refusée avant la socket. */
  port?: number;
  /** Port UDP de mesure. 0 : le système en choisit un, hors ports AVB. */
  portMesure?: number;
}

export interface TransportConsole {
  readonly nom: NomTransport;
  connecter(options: OptionsConnexion): Promise<void>;
  fermer(): Promise<void>;
  lire(chemin: string): Promise<number | boolean | string | undefined>;
  lireVersion(): Promise<string | undefined>;
  /** Instantané des clés connues. Sert au dump et à la preuve AVB, en lecture seule. */
  instantane(): Promise<ReadonlyMap<string, number | boolean | string>>;
  /** Écriture brute. La garde doit avoir filtré le chemin avant. */
  ecrire(chemin: string, valeur: number | boolean): Promise<void>;
  surChangement(auditeur: (changement: Changement) => void): () => void;
  /** Ouvre la mesure UDP. Le port choisi ne doit pas être un port AVB. */
  activerMesure(): Promise<void>;
  /** Derniers niveaux bruts par numéro de canal (1-based), groupe d'entrée si connu. */
  lireMetresBruts(): { priseConnue: boolean; valeurs: ReadonlyMap<number, number> } | undefined;
}

export interface EtatInstantane {
  valeurs: ReadonlyMap<string, number | boolean | string>;
  groupesMetres: readonly number[];
}
