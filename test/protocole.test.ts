import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { AssembleurCk, decoderCk, decoderPv, decoderTrame, encoderPv, encoderTrame } from "../src/trames.js";
import { aplatirEtat, decoderInstantaneZb, decoderUbjson } from "../src/ubjson.js";

describe("protocole UCNET", () => {
  it("retrouve la version dans un instantané children/values", () => {
    const document = Buffer.concat([
      Buffer.from([0x7b]),
      cle("children"),
      Buffer.from([0x7b]),
      cle("global"),
      Buffer.from([0x7b]),
      cle("values"),
      Buffer.from([0x7b]),
      cle("mixer_version"),
      chaine("2.8.2.103375"),
      Buffer.from([0x7d, 0x7d, 0x7d, 0x7d]),
    ]);
    const plat = aplatirEtat(decoderUbjson(document));
    assert.equal(plat.get("global/mixer_version"), "2.8.2.103375");
    const compresse = deflateSync(document);
    assert.equal(decoderInstantaneZb(compresse).get("global/mixer_version"), "2.8.2.103375");
  });

  it("fait l'aller-retour d'une valeur PV et réassemble un CK", () => {
    const trame = encoderTrame("PV", encoderPv("line/ch1/volume", 0.746));
    const decodee = decoderTrame(trame);
    assert.equal(decodee.code, "PV");
    assert.ok(Math.abs(decoderPv(decodee.charge).valeur - 0.746) < 1e-6);
    const assembleur = new AssembleurCk();
    const premier = morceau(0, 4, Buffer.from([1, 2]));
    const second = morceau(2, 4, Buffer.from([3, 4]));
    assert.equal(assembleur.ajouter(decoderCk(premier)), undefined);
    assert.deepEqual(assembleur.ajouter(decoderCk(second)), Buffer.from([1, 2, 3, 4]));
  });

  it("ne lance pas de processus dans les sources", () => {
    const racine = new URL("../src", import.meta.url).pathname;
    const textes = lireSources(racine).join("\n");
    assert.equal(textes.includes("child_process"), false);
    assert.equal(textes.includes("spawn("), false);
    assert.equal(textes.includes("execFile"), false);
  });
});

function cle(nom: string): Buffer {
  return Buffer.concat([Buffer.from([0x69, nom.length]), Buffer.from(nom)]);
}

function chaine(valeur: string): Buffer {
  return Buffer.concat([Buffer.from([0x53, 0x69, valeur.length]), Buffer.from(valeur)]);
}

function morceau(offset: number, total: number, donnees: Buffer): Buffer {
  const charge = Buffer.alloc(16 + donnees.length);
  charge.writeUInt32LE(offset, 4);
  charge.writeUInt32LE(total, 8);
  charge.writeUInt32LE(donnees.length, 12);
  donnees.copy(charge, 16);
  return charge;
}

function lireSources(dossier: string): string[] {
  const textes: string[] = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) textes.push(...lireSources(complet));
    else if (entree.name.endsWith(".ts")) textes.push(readFileSync(complet, "utf8"));
  }
  return textes;
}
