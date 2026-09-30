import { VERSION_FIRMWARE_EXIGEE } from "./constantes.js";
import { estCheminAutorise, estCleSensible, suffixesAutorises } from "./chemins.js";
import { choisirPriseMetre, GROUPE_METRE_ENTREE } from "./metres.js";

export interface LigneChemin {
  chemin: string;
  present: boolean;
  autoriseEnEcriture: boolean;
}

export interface RapportDump {
  versionLue: string | undefined;
  versionAcceptee: boolean;
  priseMetre: "pre-fader" | "post-fader" | "non-mesure";
  groupeMetreEntree: number;
  chemins: LigneChemin[];
  clesExpanderCandidates: string[];
  clesModele: string[];
  avertissements: string[];
}

export function validerEtat(
  etat: ReadonlyMap<string, number | boolean | string>,
  groupesMetres: readonly number[] = [],
  canaux: readonly number[] = [1],
): RapportDump {
  const version = lireVersion(etat);
  const avertissements: string[] = [];
  if (version !== VERSION_FIRMWARE_EXIGEE) {
    avertissements.push(
      `Firmware refusé : ${version ?? "(absent)"}. Aucune écriture ne sera faite. Ne pas mettre à jour.`,
    );
  }
  const chemins: LigneChemin[] = [];
  for (const canal of canaux) {
    for (const suffixe of suffixesAutorises()) {
      const chemin = `line/ch${canal}/${suffixe}`;
      chemins.push({
        chemin,
        present: etat.has(chemin),
        autoriseEnEcriture: estCheminAutorise(chemin),
      });
    }
  }
  const clesExpanderCandidates: string[] = [];
  const clesModele: string[] = [];
  for (const cle of etat.keys()) {
    if (/gate\/.*(expand|mode)/i.test(cle)) clesExpanderCandidates.push(cle);
    if (/compmodel|eqmodel|\/comp\/model|\/eq\/model/i.test(cle)) clesModele.push(cle);
  }
  if (clesExpanderCandidates.length === 0) {
    avertissements.push(
      "Aucun chemin expander attesté dans l'état. Le bouton Expander n'est pas écrit. Range parole seulement après calibration de gate/range.",
    );
  } else {
    avertissements.push(
      `Candidats expander vus en lecture seule, non écrits : ${clesExpanderCandidates.join(", ")}`,
    );
  }
  if (clesModele.length === 0) {
    avertissements.push(
      "Aucun sélecteur de modèle compresseur dans l'état. Les profils n'écrivent pas de modèle : Standard d'usine seulement, via on / automode / softknee.",
    );
  }
  const priseMetre = choisirPriseMetre(groupesMetres);
  if (priseMetre === "non-mesure") {
    avertissements.push("Mesure UDP pas encore ouverte : le groupe d'entrée n'a pas été observé.");
  } else if (priseMetre === "post-fader") {
    avertissements.push(
      "Le groupe mètre d'entrée 0x0000 est absent. Les niveaux seront compensés par le gain de fader déjà appliqué.",
    );
  }
  return {
    versionLue: version,
    versionAcceptee: version === VERSION_FIRMWARE_EXIGEE,
    priseMetre,
    groupeMetreEntree: GROUPE_METRE_ENTREE,
    chemins,
    clesExpanderCandidates,
    clesModele,
    avertissements,
  };
}

export function extraireSensibles(
  etat: ReadonlyMap<string, number | boolean | string>,
): Map<string, number | boolean | string> {
  const sortie = new Map<string, number | boolean | string>();
  for (const [cle, valeur] of etat) {
    if (estCleSensible(cle)) sortie.set(cle, valeur);
  }
  return sortie;
}

export interface DifferenceSensible {
  chemin: string;
  avant: number | boolean | string | undefined;
  apres: number | boolean | string | undefined;
}

export function comparerSensibles(
  avant: ReadonlyMap<string, number | boolean | string>,
  apres: ReadonlyMap<string, number | boolean | string>,
): { identique: boolean; differences: DifferenceSensible[] } {
  const cles = new Set([...extraireSensibles(avant).keys(), ...extraireSensibles(apres).keys()]);
  const differences: DifferenceSensible[] = [];
  for (const cle of cles) {
    const gauche = avant.get(cle);
    const droite = apres.get(cle);
    if (gauche !== droite) {
      differences.push({ chemin: cle, avant: gauche, apres: droite });
    }
  }
  return { identique: differences.length === 0, differences };
}

function lireVersion(etat: ReadonlyMap<string, number | boolean | string>): string | undefined {
  const valeur = etat.get("global/mixer_version") ?? etat.get("global.mixer_version");
  return valeur === undefined ? undefined : String(valeur);
}
