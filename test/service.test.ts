import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { faderDbVersFil, faderFilVersDb } from "../src/courbes.js";
import { GardeEcriture } from "../src/garde.js";
import { JournalMemoire } from "../src/journal.js";
import { ServiceAutomixer } from "../src/service.js";
import { TransportFictif } from "../src/transport/fictif.js";

async function montage(): Promise<{ service: ServiceAutomixer; transport: TransportFictif; journal: JournalMemoire }> {
  const transport = new TransportFictif();
  await transport.connecter({ hote: "127.0.0.1" });
  const journal = new JournalMemoire();
  const garde = new GardeEcriture(transport, journal);
  const service = new ServiceAutomixer(garde, transport, {
    dugan: { attenuationMaxDb: 12, zoneMorteDb: 0.25, lissageMs: 0, seuilOuvertureDb: -40 },
  });
  return { service, transport, journal };
}

describe("service", () => {
  it("restaure les nominaux au panic", async () => {
    const { service, transport } = await montage();
    service.armer([
      { canal: 1, nominalDb: 0 },
      { canal: 2, nominalDb: -6 },
    ]);
    await service.tick(
      new Map([
        [1, -10],
        [2, -10],
      ]),
      20,
    );
    await service.paniquer();
    const volumes = transport.ecritures.filter((ecriture) => ecriture.chemin.endsWith("/volume"));
    const dernier1 = volumes.filter((ecriture) => ecriture.chemin === "line/ch1/volume").at(-1);
    const dernier2 = volumes.filter((ecriture) => ecriture.chemin === "line/ch2/volume").at(-1);
    assert.equal(dernier1?.valeur, faderDbVersFil(0));
    assert.equal(dernier2?.valeur, faderDbVersFil(-6));
    assert.equal(transport.ecritures.at(-1)?.chemin.endsWith("/volume"), true);
  });

  it("gèle un canal dont le fader a bougé sans écriture du service", async () => {
    const { service, transport } = await montage();
    service.armer([
      { canal: 1, nominalDb: 0 },
      { canal: 2, nominalDb: 0 },
    ]);
    await service.tick(
      new Map([
        [1, -70],
        [2, -10],
      ]),
      20,
    );
    const avant = transport.ecritures.filter((ecriture) => ecriture.chemin === "line/ch1/volume").length;
    assert.ok(avant >= 1);
    transport.deplacerExterieur("line/ch1/volume", faderDbVersFil(-3));
    assert.equal(service.estGele(1), true);
    await service.tick(
      new Map([
        [1, -70],
        [2, -10],
      ]),
      20,
    );
    const apres = transport.ecritures.filter((ecriture) => ecriture.chemin === "line/ch1/volume").length;
    assert.equal(apres, avant);
    assert.ok(Math.abs(faderFilVersDb(faderDbVersFil(-3)) + 3) < 1e-9);
  });

  it("ne gèle pas l'écho de sa propre écriture", async () => {
    const { service, transport } = await montage();
    service.armer([{ canal: 1, nominalDb: 0 }]);
    await service.reglerFader(1, -8);
    const fil = faderDbVersFil(-8);
    transport.deplacerExterieur("line/ch1/volume", fil);
    assert.equal(service.estGele(1), false);
  });

  it("refuse le trim pendant l'automix", async () => {
    const transport = new TransportFictif();
    await transport.connecter({ hote: "127.0.0.1" });
    const garde = new GardeEcriture(transport, new JournalMemoire());
    const service = new ServiceAutomixer(garde, transport, { loiMetreConfirmee: true });
    service.armer([{ canal: 1, nominalDb: 0 }]);
    transport.definir("line/ch1/preampgain", 0.3);
    const suggestion = await service.proposerTrim(1, -30);
    service.demarrerBoucle(() => -20, 60_000);
    try {
      await assert.rejects(() => service.confirmerTrim(suggestion.jeton));
      assert.equal(transport.ecritures.some((ecriture) => ecriture.chemin.endsWith("/preampgain")), false);
    } finally {
      service.arreter();
    }
  });
});
