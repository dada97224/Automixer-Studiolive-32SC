/**
 * Cadrage UCNET tel que décrit par ucmix (frame.go, payload.go, ck.go).
 * TCP 53000 uniquement. Aucune commande de projet, de scène ou de reset.
 */

export const ENTETE = Buffer.from([0x55, 0x43, 0x00, 0x01]);
export const IDENTITE_CONNEXION = Buffer.from([0x68, 0x00, 0x65, 0x00]);

export interface Trame {
  code: string;
  charge: Buffer;
}

export class TrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrameError";
  }
}

const COMMANDES_JSON_AUTORISEES = new Set(["Subscribe", "Unsubscribe"]);

export function estCommandeJsonAutorisee(identifiant: string): boolean {
  return COMMANDES_JSON_AUTORISEES.has(identifiant);
}

export function encoderTrame(code: string, charge: Buffer): Buffer {
  if (code.length !== 2) throw new TrameError(`code de message invalide : ${code}`);
  const longueur = 6 + charge.length;
  const sortie = Buffer.alloc(4 + 2 + longueur);
  ENTETE.copy(sortie, 0);
  sortie.writeUInt16LE(longueur, 4);
  sortie.write(code, 6, "ascii");
  IDENTITE_CONNEXION.copy(sortie, 8);
  charge.copy(sortie, 12);
  return sortie;
}

export function decoderTrame(paquet: Buffer): Trame {
  if (paquet.length < 12 || !paquet.subarray(0, 4).equals(ENTETE)) {
    throw new TrameError("en-tête UCNET invalide");
  }
  const longueur = paquet.readUInt16LE(4);
  if (longueur < 6 || paquet.length < 6 + longueur) {
    throw new TrameError("trame tronquée");
  }
  return {
    code: paquet.subarray(6, 8).toString("ascii"),
    charge: paquet.subarray(12, 6 + longueur),
  };
}

/** Extrait la prochaine trame d'un tampon TCP et renvoie le reste. */
export function extraireTrame(tampon: Buffer): { trame: Trame; reste: Buffer } | undefined {
  if (tampon.length < 6) return undefined;
  if (!tampon.subarray(0, 4).equals(ENTETE)) {
    throw new TrameError("flux UCNET désynchronisé");
  }
  const longueur = tampon.readUInt16LE(4);
  const total = 6 + longueur;
  if (tampon.length < total) return undefined;
  return {
    trame: decoderTrame(tampon.subarray(0, total)),
    reste: tampon.subarray(total),
  };
}

export function encoderPv(cle: string, valeur: number): Buffer {
  const prefixe = Buffer.from(`${cle}\0\0\0`, "utf8");
  const sortie = Buffer.alloc(prefixe.length + 4);
  prefixe.copy(sortie, 0);
  sortie.writeFloatLE(valeur, prefixe.length);
  return sortie;
}

export function decoderPv(charge: Buffer): { cle: string; valeur: number } {
  const { cle, valeur } = separerCle(charge);
  if (valeur.length < 4) throw new TrameError(`PV trop court pour ${cle}`);
  return { cle, valeur: valeur.readFloatLE(0) };
}

export function decoderPs(charge: Buffer): { cle: string; valeur: string } {
  const separe = separerCle(charge);
  if (separe.valeur.length === 0 || separe.valeur[separe.valeur.length - 1] !== 0) {
    throw new TrameError(`PS sans NUL final pour ${separe.cle}`);
  }
  return {
    cle: separe.cle,
    valeur: separe.valeur.subarray(0, separe.valeur.length - 1).toString("utf8"),
  };
}

export function encoderJson(corps: { id: string }): Buffer {
  if (!estCommandeJsonAutorisee(corps.id)) {
    throw new TrameError(`commande JSON interdite : ${corps.id}`);
  }
  const json = Buffer.from(JSON.stringify(corps), "utf8");
  const sortie = Buffer.alloc(4 + json.length);
  sortie.writeUInt32LE(json.length, 0);
  json.copy(sortie, 4);
  return sortie;
}

export interface MorceauCk {
  offset: number;
  total: number;
  taille: number;
  donnees: Buffer;
}

export function decoderCk(charge: Buffer): MorceauCk {
  if (charge.length < 16) throw new TrameError("CK trop court");
  const taille = charge.readUInt32LE(12);
  const donnees = charge.subarray(16);
  if (taille !== donnees.length) {
    throw new TrameError(`CK taille ${taille} ≠ ${donnees.length}`);
  }
  return {
    offset: charge.readUInt32LE(4),
    total: charge.readUInt32LE(8),
    taille,
    donnees,
  };
}

export class AssembleurCk {
  private tampon: Buffer = Buffer.alloc(0);

  ajouter(morceau: MorceauCk): Buffer | undefined {
    if (morceau.offset === 0) this.tampon = Buffer.alloc(0);
    this.tampon = Buffer.concat([this.tampon, morceau.donnees]);
    if (morceau.offset + morceau.taille === morceau.total) {
      const complet = this.tampon;
      this.tampon = Buffer.alloc(0);
      return complet;
    }
    return undefined;
  }
}

function separerCle(charge: Buffer): { cle: string; valeur: Buffer } {
  const index = charge.indexOf(0);
  if (index < 0 || charge.length < index + 3) {
    throw new TrameError("séparateur de clé manquant");
  }
  return {
    cle: charge.subarray(0, index).toString("utf8"),
    valeur: charge.subarray(index + 3),
  };
}

/**
 * Hello (UM) : annonce le port UDP de mesure choisi par le client.
 * Le port doit déjà avoir été validé hors de la liste AVB.
 */
export function encoderHelloMesure(portUdp: number): Buffer {
  const charge = Buffer.alloc(2);
  charge.writeUInt16LE(portUdp, 0);
  return encoderTrame("UM", charge);
}
