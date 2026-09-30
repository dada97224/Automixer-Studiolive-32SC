import { inflateSync } from "node:zlib";

/**
 * Sous-ensemble UBJSON utilisé par l'instantané ZB UCNET.
 * Même marqueurs que steveclarke/ucmix (internal/proto/zb.go) plus l'entier 16 bits
 * observé par featherbear. Les enveloppes "children" et "values" ne font pas
 * partie du chemin de contrôle.
 */

const DEBUT_OBJET = 0x7b;
const FIN_OBJET = 0x7d;
const DEBUT_TABLEAU = 0x5b;
const FIN_TABLEAU = 0x5d;
const MARQUEUR_CLE = 0x69;
const CHAINE = 0x53;
const FLOTTANT32 = 0x64;
const ENTIER8 = 0x69;
const ENTIER16 = 0x49;
const ENTIER32 = 0x6c;
const ENTIER64 = 0x4c;
const OCTET = 0x55;

export type ValeurUbjson = string | number | bigint | ValeurUbjson[] | { [cle: string]: ValeurUbjson };

export class UbjsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UbjsonError";
  }
}

export function decoderUbjson(buffer: Buffer): Record<string, ValeurUbjson> {
  if (buffer.length === 0 || buffer[0] !== DEBUT_OBJET) {
    throw new UbjsonError("racine UBJSON invalide");
  }
  let index = 1;
  return lireObjet(buffer, () => index, (valeur) => {
    index = valeur;
  });
}

export function aplatirEtat(arbre: Record<string, ValeurUbjson>): Map<string, ValeurUbjson> {
  const sortie = new Map<string, ValeurUbjson>();
  aplatir("", arbre, sortie);
  return sortie;
}

export function decoderInstantaneZb(chargeUtile: Buffer): Map<string, ValeurUbjson> {
  const brut = inflateSync(chargeUtile);
  const arbre = decoderUbjson(brut);
  return aplatirEtat(arbre);
}

function aplatir(prefixe: string, noeud: Record<string, ValeurUbjson>, sortie: Map<string, ValeurUbjson>): void {
  for (const [cle, valeur] of Object.entries(noeud)) {
    if (cle === "children" || cle === "values") {
      if (estObjet(valeur)) aplatir(prefixe, valeur, sortie);
      continue;
    }
    if (cle === "strings" || cle === "ranges") continue;
    const chemin = prefixe.length === 0 ? cle : `${prefixe}/${cle}`;
    if (estObjet(valeur)) {
      aplatir(chemin, valeur, sortie);
      continue;
    }
    sortie.set(chemin, valeur);
  }
}

function estObjet(valeur: ValeurUbjson): valeur is Record<string, ValeurUbjson> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

function lireObjet(
  buffer: Buffer,
  lireIndex: () => number,
  ecrireIndex: (valeur: number) => void,
): Record<string, ValeurUbjson> {
  const objet: Record<string, ValeurUbjson> = {};
  for (;;) {
    const index = lireIndex();
    if (index >= buffer.length) throw new UbjsonError("objet UBJSON tronqué");
    const controle = buffer[index];
    if (controle === undefined) throw new UbjsonError("octet manquant");
    ecrireIndex(index + 1);
    if (controle === FIN_OBJET) return objet;
    if (controle !== MARQUEUR_CLE) {
      throw new UbjsonError(`marqueur de clé attendu, reçu 0x${controle.toString(16)}`);
    }
    const cle = lireComptee(buffer, lireIndex, ecrireIndex).toString("utf8");
    objet[cle] = lireValeur(buffer, lireIndex, ecrireIndex);
  }
}

function lireTableau(
  buffer: Buffer,
  lireIndex: () => number,
  ecrireIndex: (valeur: number) => void,
): ValeurUbjson[] {
  const tableau: ValeurUbjson[] = [];
  for (;;) {
    const index = lireIndex();
    if (index >= buffer.length) throw new UbjsonError("tableau UBJSON tronqué");
    if (buffer[index] === FIN_TABLEAU) {
      ecrireIndex(index + 1);
      return tableau;
    }
    tableau.push(lireValeur(buffer, lireIndex, ecrireIndex));
  }
}

function lireValeur(
  buffer: Buffer,
  lireIndex: () => number,
  ecrireIndex: (valeur: number) => void,
): ValeurUbjson {
  const index = lireIndex();
  if (index >= buffer.length) throw new UbjsonError("valeur UBJSON tronquée");
  const type = buffer[index];
  if (type === undefined) throw new UbjsonError("type manquant");
  ecrireIndex(index + 1);
  switch (type) {
    case DEBUT_OBJET:
      return lireObjet(buffer, lireIndex, ecrireIndex);
    case DEBUT_TABLEAU:
      return lireTableau(buffer, lireIndex, ecrireIndex);
    case CHAINE: {
      if (buffer[lireIndex()] !== MARQUEUR_CLE) {
        throw new UbjsonError("longueur de chaîne inattendue");
      }
      ecrireIndex(lireIndex() + 1);
      return lireComptee(buffer, lireIndex, ecrireIndex).toString("utf8");
    }
    case FLOTTANT32:
      return lireN(buffer, 4, lireIndex, ecrireIndex).readFloatBE(0);
    case ENTIER16:
      return lireN(buffer, 2, lireIndex, ecrireIndex).readInt16BE(0);
    case ENTIER32:
      return lireN(buffer, 4, lireIndex, ecrireIndex).readInt32BE(0);
    case ENTIER64:
      return lireN(buffer, 8, lireIndex, ecrireIndex).readBigInt64BE(0);
    case OCTET:
      return lireN(buffer, 1, lireIndex, ecrireIndex).readUInt8(0);
    case ENTIER8:
      return lireN(buffer, 1, lireIndex, ecrireIndex).readInt8(0);
    default:
      throw new UbjsonError(`type UBJSON inconnu 0x${type.toString(16)}`);
  }
}

function lireComptee(
  buffer: Buffer,
  lireIndex: () => number,
  ecrireIndex: (valeur: number) => void,
): Buffer {
  const index = lireIndex();
  const longueur = buffer[index];
  if (longueur === undefined) throw new UbjsonError("longueur manquante");
  ecrireIndex(index + 1);
  return lireN(buffer, longueur, lireIndex, ecrireIndex);
}

function lireN(
  buffer: Buffer,
  longueur: number,
  lireIndex: () => number,
  ecrireIndex: (valeur: number) => void,
): Buffer {
  const index = lireIndex();
  if (index + longueur > buffer.length) throw new UbjsonError("troncature UBJSON");
  ecrireIndex(index + longueur);
  return buffer.subarray(index, index + longueur);
}
