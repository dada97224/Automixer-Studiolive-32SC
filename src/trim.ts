import { randomBytes } from "node:crypto";

export class TrimRefuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrimRefuseError";
  }
}

export interface SuggestionTrim {
  canal: number;
  jeton: string;
  filActuel: number;
  filPropose: number;
  sens: "monter" | "descendre" | "tenir";
  metreDb: number;
  cibleDb: number;
}

const PAS_FIL = 0.02;

/**
 * Le préampli est un flottant 0..1 (ucmix, PROTOCOL.md, clé preampgain).
 * La loi dB n'est pas attestée sur 2.8.2 : on ne propose qu'un petit pas,
 * dans le sens du niveau mesuré, et on n'écrit rien ici.
 */
export function suggererTrim(params: {
  canal: number;
  filActuel: number;
  metreDb: number;
  cibleDb?: number;
}): SuggestionTrim {
  const cible = params.cibleDb ?? -18;
  const ecart = params.metreDb - cible;
  let sens: SuggestionTrim["sens"] = "tenir";
  let delta = 0;
  if (ecart > 1) {
    sens = "descendre";
    delta = -PAS_FIL;
  } else if (ecart < -1) {
    sens = "monter";
    delta = PAS_FIL;
  }
  const filPropose = Math.min(1, Math.max(0, params.filActuel + delta));
  return {
    canal: params.canal,
    jeton: randomBytes(8).toString("hex"),
    filActuel: params.filActuel,
    filPropose,
    sens,
    metreDb: params.metreDb,
    cibleDb: cible,
  };
}

export function confirmerTrim(params: {
  suggestion: SuggestionTrim | undefined;
  jeton: string;
  automixActif: boolean;
}): number {
  if (params.automixActif) {
    throw new TrimRefuseError("trim interdit pendant l'automix");
  }
  if (params.suggestion === undefined || params.suggestion.jeton !== params.jeton) {
    throw new TrimRefuseError("confirmation explicite manquante ou jeton périmé");
  }
  if (params.suggestion.sens === "tenir") {
    throw new TrimRefuseError("aucun déplacement de trim à confirmer");
  }
  return params.suggestion.filPropose;
}
