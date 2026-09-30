import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { faderDbVersFil } from "../src/courbes.js";
import { GardeEcriture } from "../src/garde.js";
import { demarrerHttp } from "../src/http.js";
import { JournalMemoire } from "../src/journal.js";
import { ServiceAutomixer } from "../src/service.js";
import { TransportFictif } from "../src/transport/fictif.js";

describe("réglage manuel localhost", () => {
  it("écrit un fader puis panic par HTTP", async () => {
    const transport = new TransportFictif();
    await transport.connecter({ hote: "127.0.0.1" });
    const journal = new JournalMemoire();
    const service = new ServiceAutomixer(new GardeEcriture(transport, journal), transport, {
      dugan: { lissageMs: 0, seuilOuvertureDb: -40 },
    });
    const http = await demarrerHttp({ service, journal, port: 0 });
    try {
      const arme = await fetch(`${http.url}/armer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canaux: [{ canal: 4, nominalDb: -2 }] }),
      });
      assert.equal(arme.status, 200);
      const fader = await fetch(`${http.url}/fader`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canal: 4, db: -8 }),
      });
      assert.equal(fader.status, 200);
      assert.equal(transport.ecritures.at(-1)?.valeur, faderDbVersFil(-8));
      const interdit = await fetch(`${http.url}/fader`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ canal: 4, db: 40 }),
      });
      assert.equal(interdit.status, 400);
      const panic = await fetch(`${http.url}/panic`, { method: "POST" });
      assert.equal(panic.status, 200);
      assert.equal(transport.ecritures.at(-1)?.valeur, faderDbVersFil(-2));
      const etat = await fetch(`${http.url}/etat`);
      const corps = (await etat.json()) as { journal: { motif: string }[] };
      assert.ok(corps.journal.some((entree) => entree.motif === "panic"));
    } finally {
      await http.fermer();
    }
  });
});
