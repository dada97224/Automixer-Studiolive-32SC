# Automixer StudioLive 32 SC

Service local pour une console PreSonus/Fender StudioLive 32 SC dont le firmware est figé à **2.8.2.103375**. Il ne propose pas de mise à jour : le passage AVB Milan casse l'écosystème en place.

Pilotage UCNET sur le port Control uniquement (TCP 53000) et mesure UDP. Les ports AVB ne sont pas ouverts. Horloge, Remote I/O, flux AVB, mode USB, 48 V, projets et scènes ne sont pas écrits.

## Lancer les tests

```bash
npm install
npm test
npm run typecheck
```

Les tests couvrent le transport fictif (version refusée, chemin hors liste blanche, panic, gel de fader) et l'automixer Dugan (partage, dernier micro tenu, zone morte 0,25 dB, borne -12 dB, lissage). Aucune console n'est requise.

## Brancher la console

```bash
npm run dump -- --hote 192.168.x.x --sortie data/avant.json
npm run servir -- --hote 192.168.x.x
```

`servir` écoute **uniquement** sur `127.0.0.1:8787`. Le transport par défaut est `@featherbear/presonus-studiolive-api`. S'il ne lit pas la version, le service ouvre un client UCNET persistant du même cadrage que `steveclarke/ucmix`, sans lancer le CLI dans la boucle.

Le protocole d'écoute sur la console réelle est dans [docs/protocole-essai-console.md](docs/protocole-essai-console.md).
