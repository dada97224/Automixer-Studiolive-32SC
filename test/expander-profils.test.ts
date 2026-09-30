import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { assertRangeParole, preparerEcrituresExpander } from "../src/expander.js";
import { chargerProfilsDisque, ecrituresDuProfil, intentionDuRole, ROLES } from "../src/profils.js";
import { limiteurDbVersFil } from "../src/courbes.js";

describe("expander et profils", () => {
  it("borne le range parole à -20..-12 dB", () => {
    assert.equal(assertRangeParole(-16), -16);
    assert.equal(assertRangeParole(-12), -12);
    assert.equal(assertRangeParole(-20), -20);
    assert.throws(() => assertRangeParole(-11));
    assert.throws(() => assertRangeParole(-21));
    assert.throws(() => assertRangeParole(-84));
  });

  it("n'écrit pas gate/range sans calibration et n'invente pas l'expander", () => {
    const ecritures = preparerEcrituresExpander(-16, undefined);
    assert.equal(ecritures.find((ecriture) => ecriture.suffixe === "gate/on")?.ecrit, true);
    assert.equal(ecritures.find((ecriture) => ecriture.suffixe === "gate/range")?.ecrit, false);
    assert.equal(ecritures.some((ecriture) => ecriture.suffixe.includes("expand")), false);
  });

  it("écrit le range calibré et seulement des paramètres sûrs par rôle", () => {
    const ecritures = ecrituresDuProfil("presentateur", [
      { humain: -20, fil: 0.2 },
      { humain: -12, fil: 0.4 },
    ]);
    const suffixes = ecritures.map((ecriture) => ecriture.suffixe);
    assert.ok(suffixes.includes("gate/range"));
    const range = ecritures.find((ecriture) => ecriture.suffixe === "gate/range")?.valeur;
    assert.equal(typeof range, "number");
    assert.ok(typeof range === "number" && Math.abs(range - 0.3) < 1e-12);
    assert.deepEqual(suffixes.sort(), [
      "comp/automode",
      "comp/on",
      "comp/softknee",
      "gate/on",
      "gate/range",
      "limit/limiteron",
      "limit/threshold",
    ]);
    assert.equal(
      ecritures.find((ecriture) => ecriture.suffixe === "limit/threshold")?.valeur,
      limiteurDbVersFil(-6),
    );
    for (const role of ROLES) {
      const intention = intentionDuRole(role);
      assert.equal(intention.intentions.modeleCompresseur, "standard");
      assert.equal(intention.groupe, "parole");
      assert.ok(intention.incertitudes.length >= 3);
    }
    const disque = chargerProfilsDisque(fileURLToPath(new URL("../profils/", import.meta.url)));
    assert.equal(disque.length, 3);
  });
});
