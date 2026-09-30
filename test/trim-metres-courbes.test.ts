import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { faderDbVersFil, faderFilVersDb, filDepuisCalibration, limiteurDbVersFil } from "../src/courbes.js";
import { comparerSensibles, validerEtat } from "../src/dump.js";
import { choisirPriseMetre, decoderNiveaux, niveauPourAutomix } from "../src/metres.js";
import { confirmerTrim, suggererTrim } from "../src/trim.js";

describe("trim, mètres et courbes", () => {
  it("propose un pas de trim et n'écrit qu'avec le jeton", () => {
    const tropFort = suggererTrim({ canal: 3, filActuel: 0.5, metreDb: -6, cibleDb: -18 });
    assert.equal(tropFort.sens, "descendre");
    assert.ok(tropFort.filPropose < tropFort.filActuel);
    assert.throws(() => confirmerTrim({ suggestion: tropFort, jeton: "mauvais", automixActif: false }));
    assert.throws(() => confirmerTrim({ suggestion: tropFort, jeton: tropFort.jeton, automixActif: true }));
    assert.equal(
      confirmerTrim({ suggestion: tropFort, jeton: tropFort.jeton, automixActif: false }),
      tropFort.filPropose,
    );
    const juste = suggererTrim({ canal: 3, filActuel: 0.5, metreDb: -18, cibleDb: -18 });
    assert.equal(juste.sens, "tenir");
  });

  it("compense un mètre post-fader et reconnaît l'entrée", () => {
    assert.equal(choisirPriseMetre([]), "non-mesure");
    assert.equal(choisirPriseMetre([0x0000]), "pre-fader");
    assert.equal(choisirPriseMetre([0x0400]), "post-fader");
    assert.equal(niveauPourAutomix(-20, -6, "pre-fader"), -20);
    assert.equal(niveauPourAutomix(-20, -6, "post-fader"), -14);
  });

  it("retrouve les ancres publiées du fader et du limiteur", () => {
    assert.equal(faderDbVersFil(-84), 0);
    assert.equal(faderDbVersFil(-6), 0.746);
    assert.equal(faderDbVersFil(10), 1);
    assert.ok(Math.abs(faderFilVersDb(74.6) + 6) < 1e-9);
    assert.ok(Math.abs(limiteurDbVersFil(-6) - 22 / 28) < 1e-12);
    assert.ok(Math.abs(filDepuisCalibration([{ humain: -20, fil: 0.2 }, { humain: -12, fil: 0.4 }], -16) - 0.3) < 1e-12);
    assert.throws(() => filDepuisCalibration([{ humain: -20, fil: 0.2 }], -16));
  });

  it("signale une version fausse et une dérive sensible", () => {
    const etat = new Map<string, number | boolean | string>([
      ["global/mixer_version", "2.8.2.999"],
      ["line/ch1/48v", true],
      ["line/ch1/volume", 0.5],
    ]);
    const rapport = validerEtat(etat, [], [1]);
    assert.equal(rapport.versionAcceptee, false);
    assert.equal(rapport.chemins.every((ligne) => ligne.autoriseEnEcriture), true);
    assert.equal(rapport.chemins.some((ligne) => ligne.chemin.includes("48v")), false);
    const apres = new Map(etat);
    apres.set("line/ch1/48v", false);
    apres.set("line/ch1/volume", 0.2);
    const diff = comparerSensibles(etat, apres);
    assert.equal(diff.identique, false);
    assert.deepEqual(diff.differences.map((ligne) => ligne.chemin), ["line/ch1/48v"]);
  });

  it("décode un bloc de niveaux levl", () => {
    const valeurs = [10, 20];
    const charge = Buffer.alloc(21 + valeurs.length * 2 + 6);
    charge.write("UC", 0, "ascii");
    charge[2] = 0;
    charge[3] = 1;
    charge.write("MS", 6, "ascii");
    charge.write("levl", 12, "ascii");
    charge.writeUInt16LE(valeurs.length, 18);
    valeurs.forEach((valeur, index) => charge.writeUInt16LE(valeur, 20 + index * 2));
    const descripteur = 20 + valeurs.length * 2;
    charge[descripteur] = 1;
    charge.writeInt16BE(0x0000, descripteur + 1);
    charge.writeInt16LE(0, descripteur + 3);
    charge.writeInt16LE(2, descripteur + 5);
    const groupes = decoderNiveaux(charge);
    assert.equal(groupes?.[0]?.groupe, 0);
    assert.deepEqual(groupes?.[0]?.valeurs, [10, 20]);
  });
});
