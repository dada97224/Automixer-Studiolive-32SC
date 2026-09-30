import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { limiteurDbVersFil, type PointCalibration } from "./courbes.js";
import { preparerEcrituresExpander } from "./expander.js";

export const ROLES = ["presentateur", "invite", "animateur"] as const;
export type Role = (typeof ROLES)[number];

export interface IntentionDynamique {
  role: Role;
  groupe: "parole";
  /** Valeurs humaines souhaitées. Non écrites si leur courbe fil n'est pas attestée. */
  intentions: {
    gateRangeDb: number;
    compSeuilDb: number;
    compRatio: string;
    limiteurSeuilDb: number;
    modeleCompresseur: "standard";
  };
  incertitudes: string[];
}

export interface EcritureProfil {
  suffixe: string;
  valeur: number | boolean;
  motif: string;
}

export function estRole(valeur: string): valeur is Role {
  return (ROLES as readonly string[]).includes(valeur);
}

export function intentionDuRole(role: Role): IntentionDynamique {
  const commune = {
    groupe: "parole" as const,
    incertitudes: [
      "Le sélecteur de modèle (Standard, Tube Leveling Amplifier, Class-A FET) n'a pas de chemin UCNET attesté sur 2.8.2.103375. Aucun modèle n'est écrit : on reste sur le Standard déjà chargé, qui est le défaut d'usine (manuel V6 §6.5.1).",
      "Le bouton Expander n'a pas de chemin attesté. Range est inactif quand l'expander est engagé (manuel §6.4.1). Le range parole n'est écrit qu'après calibration locale de gate/range.",
      "Seuil, ratio, attaque et relâchement du compresseur restent en intention : automode utilise la courbe interne 10 ms / 150 ms attestée par le manuel, sans écrire de flottants devinés.",
      "La courbe du limiteur est linéaire -28..0 dB d'après ucmix, mesurée en firmware 3.4.0. À vérifier sur la tranche avant une générale.",
    ],
  };
  switch (role) {
    case "presentateur":
      return {
        role,
        ...commune,
        intentions: {
          gateRangeDb: -16,
          compSeuilDb: -18,
          compRatio: "2.5:1",
          limiteurSeuilDb: -6,
          modeleCompresseur: "standard",
        },
      };
    case "invite":
      return {
        role,
        ...commune,
        intentions: {
          gateRangeDb: -18,
          compSeuilDb: -16,
          compRatio: "3:1",
          limiteurSeuilDb: -6,
          modeleCompresseur: "standard",
        },
      };
    case "animateur":
      return {
        role,
        ...commune,
        intentions: {
          gateRangeDb: -14,
          compSeuilDb: -14,
          compRatio: "2:1",
          limiteurSeuilDb: -3,
          modeleCompresseur: "standard",
        },
      };
    default: {
      const _exhaustif: never = role;
      return _exhaustif;
    }
  }
}

export function ecrituresDuProfil(
  role: Role,
  calibrationRange?: readonly PointCalibration[],
): EcritureProfil[] {
  const intention = intentionDuRole(role);
  const ecritures: EcritureProfil[] = [];
  for (const range of preparerEcrituresExpander(intention.intentions.gateRangeDb, calibrationRange)) {
    if (!range.ecrit) continue;
    ecritures.push({
      suffixe: range.suffixe,
      valeur: range.valeur,
      motif: `profil:${role}:${range.raison}`,
    });
  }
  ecritures.push(
    { suffixe: "comp/on", valeur: true, motif: `profil:${role}:compresseur standard actif` },
    { suffixe: "comp/automode", valeur: true, motif: `profil:${role}:attaque 10 ms et relâchement 150 ms internes` },
    { suffixe: "comp/softknee", valeur: true, motif: `profil:${role}:coude progressif` },
    { suffixe: "limit/limiteron", valeur: true, motif: `profil:${role}:limiteur actif` },
    {
      suffixe: "limit/threshold",
      valeur: limiteurDbVersFil(intention.intentions.limiteurSeuilDb),
      motif: `profil:${role}:seuil limiteur ${intention.intentions.limiteurSeuilDb} dB`,
    },
  );
  return ecritures;
}

export function chargerProfilsDisque(dossier: string): IntentionDynamique[] {
  const fichiers = readdirSync(dossier).filter((nom) => nom.endsWith(".json"));
  return fichiers.map((nom) => {
    const brut = JSON.parse(readFileSync(path.join(dossier, nom), "utf8")) as { role?: string };
    if (brut.role === undefined || !estRole(brut.role)) {
      throw new Error(`profil local invalide : ${nom}`);
    }
    return intentionDuRole(brut.role);
  });
}
