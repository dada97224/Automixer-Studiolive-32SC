import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doitEcrire, lisser, MoteurDugan, offsetsPartage } from "../src/dugan.js";

const options = {
  attenuationMaxDb: 12,
  zoneMorteDb: 0.25,
  lissageMs: 0,
  seuilOuvertureDb: -40,
};

describe("partage de gain Dugan", () => {
  it("donne environ -3 dB à deux voix égales", () => {
    const moteur = new MoteurDugan(options);
    const resultat = moteur.tick(
      [
        { id: "1", niveauDb: -12, nominalDb: 0, gele: false },
        { id: "2", niveauDb: -12, nominalDb: 0, gele: false },
      ],
      20,
    );
    assert.ok(Math.abs((resultat.offsetsDb["1"] ?? 0) + 3.010299956639812) < 1e-9);
    assert.ok(Math.abs((resultat.offsetsDb["2"] ?? 0) + 3.010299956639812) < 1e-9);
  });

  it("borne l'atténuation à -12 dB sous le nominal", () => {
    const partage = offsetsPartage(
      [
        { id: "1", niveauDb: 0, nominalDb: -5, gele: false },
        { id: "2", niveauDb: -60, nominalDb: -5, gele: false },
      ],
      null,
      { ...options, seuilOuvertureDb: -80 },
    );
    assert.equal(partage.offsets.get("2"), -12);
    const moteur = new MoteurDugan({ ...options, seuilOuvertureDb: -80 });
    const resultat = moteur.tick(
      [
        { id: "1", niveauDb: 0, nominalDb: -5, gele: false },
        { id: "2", niveauDb: -60, nominalDb: -5, gele: false },
      ],
      20,
    );
    assert.equal(resultat.fadersDb["2"], -17);
    assert.ok((resultat.offsetsDb["2"] ?? 0) >= -12);
  });

  it("tient le dernier micro quand plus personne ne parle", () => {
    const moteur = new MoteurDugan(options);
    moteur.tick(
      [
        { id: "1", niveauDb: -10, nominalDb: 0, gele: false },
        { id: "2", niveauDb: -70, nominalDb: 0, gele: false },
      ],
      20,
    );
    const silence = moteur.tick(
      [
        { id: "1", niveauDb: -70, nominalDb: 0, gele: false },
        { id: "2", niveauDb: -70, nominalDb: 0, gele: false },
      ],
      20,
    );
    assert.equal(silence.tenu, "1");
    assert.equal(silence.fadersDb["1"], 0);
    assert.equal(silence.fadersDb["2"], -12);
  });

  it("respecte la zone morte de 0,25 dB", () => {
    assert.equal(doitEcrire(0, 0.249, 0.25), false);
    assert.equal(doitEcrire(0, -0.249, 0.25), false);
    assert.equal(doitEcrire(0, 0.25, 0.25), true);
    assert.equal(doitEcrire(-6, -6.25, 0.25), true);
    const moteur = new MoteurDugan(options);
    const premier = moteur.tick([{ id: "1", niveauDb: -10, nominalDb: 0, gele: false }], 20);
    const second = moteur.tick([{ id: "1", niveauDb: -10, nominalDb: 0, gele: false }], 20);
    assert.equal(premier.ecritures.length, 0);
    assert.equal(second.ecritures.length, 0);
    const deuxVoix = moteur.tick(
      [
        { id: "1", niveauDb: -10, nominalDb: 0, gele: false },
        { id: "2", niveauDb: -10, nominalDb: 0, gele: false },
      ],
      20,
    );
    assert.ok(deuxVoix.ecritures.some((ecriture) => ecriture.id === "1"));
  });

  it("lisse au lieu de sauter à la cible", () => {
    const moteur = new MoteurDugan({ ...options, lissageMs: 100 });
    const premier = moteur.tick(
      [
        { id: "1", niveauDb: -10, nominalDb: 0, gele: false },
        { id: "2", niveauDb: -10, nominalDb: 0, gele: false },
      ],
      5,
    );
    assert.equal(premier.ecritures.length, 0);
    assert.ok((premier.offsetsDb["1"] ?? -99) > -1);
    let ecrit = false;
    for (let i = 0; i < 40; i += 1) {
      const tour = moteur.tick(
        [
          { id: "1", niveauDb: -10, nominalDb: 0, gele: false },
          { id: "2", niveauDb: -10, nominalDb: 0, gele: false },
        ],
        20,
      );
      if (tour.ecritures.length > 0) ecrit = true;
      assert.ok((tour.offsetsDb["1"] ?? -99) > -3.02);
    }
    assert.equal(ecrit, true);
    const pas = lisser(0, -12, 10, 100);
    assert.ok(pas < -1 && pas > -1.2);
  });
});
