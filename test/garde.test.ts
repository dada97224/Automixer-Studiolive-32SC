import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GardeEcriture } from "../src/garde.js";
import { JournalMemoire } from "../src/journal.js";
import { CheminRefuseError, VersionRefuseeError } from "../src/chemins.js";
import { TransportFictif } from "../src/transport/fictif.js";
import { encoderJson } from "../src/trames.js";
import { assertPortControle, assertPortMesure } from "../src/ports.js";

async function gardeAvec(version: string): Promise<{ garde: GardeEcriture; transport: TransportFictif; journal: JournalMemoire }> {
  const transport = new TransportFictif(version);
  await transport.connecter({ hote: "127.0.0.1" });
  const journal = new JournalMemoire();
  return { garde: new GardeEcriture(transport, journal), transport, journal };
}

describe("garde d'écriture", () => {
  it("refuse une version de firmware différente", async () => {
    const { garde, transport } = await gardeAvec("3.3.0.109659");
    await assert.rejects(() => garde.ecrire("line/ch1/volume", 0.5, "test"), VersionRefuseeError);
    assert.equal(transport.ecritures.length, 0);
  });

  it("refuse un chemin hors liste blanche, y compris un essai fictif", async () => {
    const { garde, transport } = await gardeAvec("2.8.2.103375");
    const interdits = [
      "line/ch1/48v",
      "line/ch1/mute",
      "avb/stream/1",
      "global/clocksource",
      "presets/loaded_scene_name",
      "line/ch1/usb_src",
      "stageboxsetup/remote",
      "line/ch33/volume",
      "aux/ch1/volume",
    ];
    for (const chemin of interdits) {
      await assert.rejects(() => garde.ecrire(chemin, 1, "integration-fictive"), CheminRefuseError);
    }
    assert.equal(transport.ecritures.length, 0);
    await garde.ecrire("line/ch1/volume", 0.746, "manuel");
    assert.equal(transport.ecritures.length, 1);
    assert.equal(transport.ecritures[0]?.chemin, "line/ch1/volume");
  });

  it("refuse le trim sans confirmation et le journalise seulement quand il passe", async () => {
    const { garde, journal } = await gardeAvec("2.8.2.103375");
    await assert.rejects(
      () => garde.ecrire("line/ch2/preampgain", 0.4, "trim"),
      CheminRefuseError,
    );
    garde.automixActif = true;
    await assert.rejects(
      () => garde.ecrire("line/ch2/preampgain", 0.4, "trim-confirme", { trimConfirme: true }),
      CheminRefuseError,
    );
    garde.automixActif = false;
    await garde.ecrire("line/ch2/preampgain", 0.4, "trim-confirme", { trimConfirme: true });
    assert.equal(journal.lire().at(-1)?.motif, "trim-confirme");
  });

  it("n'autorise pas les commandes de scène ni les ports AVB", () => {
    assert.throws(() => encoderJson({ id: "RestorePreset" }));
    assert.throws(() => encoderJson({ id: "StorePreset" }));
    assert.throws(() => encoderJson({ id: "ResetMixer" }));
    assert.doesNotThrow(() => encoderJson({ id: "Subscribe" }));
    assert.throws(() => assertPortControle(53001));
    assert.throws(() => assertPortControle(17221));
    assert.doesNotThrow(() => assertPortControle(53000));
    assert.throws(() => assertPortMesure(53000));
    assert.throws(() => assertPortMesure(319));
  });
});
