# Protocole d'essai sur la StudioLive 32 SC

À faire sur la console réelle, firmware **exactement** `2.8.2.103375`. Ne pas lancer de mise à jour, ne pas ouvrir l'écran de firmware, ne pas accepter une invite Universal Control qui propose un firmware plus récent.

Réseau : le Mac et la console se voient en IP. Le service ne parle qu'au port TCP **53000**. Il ouvre un UDP local pour les mètres. Il ne doit pas y avoir de câble ou de session dont on changerait les flux AVB pendant l'essai.

Choisir deux canaux parole déjà patchés, 48 V déjà dans l'état voulu, faders au nominal de spectacle. Noter ces nominaux (exemple : canal 1 à 0 dB, canal 2 à -6 dB).

## 0. Dump et preuve de départ

1. Sur la console, noter ou photographier : source d'horloge, page AVB (nombre de flux, état des streams), mode USB, voyants 48 V des canaux d'essai, nom du projet et de la scène chargés.
2. Depuis le dépôt :

```bash
npm run dump -- --hote ADRESSE_CONSOLE --sortie data/avant.json
```

3. Dans `data/avant.json`, `rapport.versionAcceptee` doit être `true` et `rapport.versionLue` doit être `2.8.2.103375`. Si ce n'est pas le cas, **s'arrêter**. Aucune écriture n'est légitime.
4. Lire les avertissements : le bouton Expander et le sélecteur de modèle de compresseur ne sont pas écrits tant que leur chemin n'est pas attesté. Le Standard d'usine reste en place.
5. Garder `data/avant.json`. Le bloc `sensibles` est la photo des clés horloge, AVB, USB, 48 V, presets.

## Ce qui est volontairement incertain

- Courbe de fader : ancres ucmix 0 = -84 dB, 0,746 = -6 dB, 1 = +10 dB, mesurées en firmware 3.4.0. À l'étape 1, vérifier que -6 dB demandé s'affiche -6 dB sur la tranche.
- Courbe du limiteur : droite -28..0 dB, point connu -6 dB. Vérifier le scribble du limiteur.
- `gate/range`, seuil et ratio du compresseur : pas de loi fil attestée. Ils ne partent pas tant qu'une calibration locale à deux points n'existe pas. Le compresseur n'est armé qu'en booléens (`comp/on`, `comp/automode`, `comp/softknee`). Le manuel V6 §6.5.1 dit qu'Auto fixe 10 ms / 150 ms.
- Bouton Expander : chemin UCNET inconnu. Le manuel §6.4.1 dit que Range est inactif quand l'expander est engagé. Le service n'envoie pas de chemin inventé. Pour une atténuation de bruit de -12 à -20 dB, rester en mode gate et ne calibrer `gate/range` qu'après avoir lu le fil à -20 dB puis à -12 dB sur la tranche.
- Mètres : le groupe `0x0000` (entrée) est traité pré-fader. S'il manque, le service retranche le gain de fader. **Ne pas lancer la boucle** tant que l'étape silence / une voix n'a pas montré que les niveaux suivent l'entrée et pas le fader. `loiMetreConfirmee` reste fausse tant que cet essai n'est pas fait.

Les profils `profils/*.json` restent sur le disque du Mac. Ils ne sont pas des scènes.

## 1. Silence

1. Personne aux micros. Casques ou enceintes très bas.
2. Armer les nominaux :

```bash
curl -s -X POST http://127.0.0.1:8787/armer \
  -H 'content-type: application/json' \
  -d '{"canaux":[{"canal":1,"nominalDb":0},{"canal":2,"nominalDb":-6}]}'
```

(adapter les canaux et les dB). `npm run servir` doit déjà tourner.

3. Les deux faders ne doivent pas avoir bougé tant qu'aucun tick n'est envoyé.
4. Envoyer un tick de silence (niveaux très bas) :

```bash
curl -s -X POST http://127.0.0.1:8787/automix/tick \
  -H 'content-type: application/json' \
  -d '{"dtMs":80,"niveaux":[{"canal":1,"niveauDb":-80},{"canal":2,"niveauDb":-80}]}'
```

5. Attendu : un canal (le premier tenu) reste au nominal, l'autre descend d'au plus 12 dB. Pas de bond au-delà. Pas de clic dans le 48 V. La scène affichée n'a pas changé.

## 2. Une voix

1. Parler seulement dans le micro 1, micro 2 au silence.
2. Tick avec un niveau réaliste sur le 1 (par exemple -18) et -80 sur le 2. Répéter quelques fois.
3. Attendu : le fader 1 revient vers son nominal (un seul micro ouvert, partage ≈ 0 dB). Le fader 2 reste au plus à nominal - 12 dB. Le mouvement est progressif si la boucle lisse (80 ms par défaut).
4. Vérifier sur la tranche que le mètre d'entrée bouge avec la voix **avant** de bouger le fader. Si le mètre suit le fader, la prise est post-fader : ne pas confirmer la loi, compenser, refaire l'essai.

## 3. Deux voix

1. Parler en même temps, niveaux proches.
2. Attendu : chaque fader s'approche d'environ -3 dB sous son nominal, pas -6 dB (partage en puissance). Aucun des deux ne passe sous nominal - 12 dB.
3. Se taire des deux côtés. Attendu : le dernier micro qui parlait reste tenu (son fader remonte au nominal), l'autre reste atténué. La pièce ne doit pas « pomper » jusqu'au silence numérique.

## 4. Override fader

1. Pendant que l'automix écrit, pousser le fader 1 à la main d'au moins 1 dB.
2. Attendu : le service gèle ce canal. Les ticks suivants ne le réécrivent pas. L'autre canal continue.
3. Libérer seulement quand l'opérateur le décide :

```bash
curl -s -X POST http://127.0.0.1:8787/gel/liberer \
  -H 'content-type: application/json' \
  -d '{"canal":1}'
```

## 5. Panic

```bash
curl -s -X POST http://127.0.0.1:8787/panic
```

Attendu : les deux faders reviennent aux nominaux armés, le gel est levé, l'automix s'arrête. Le journal `GET http://127.0.0.1:8787/journal` contient des lignes `"motif":"panic"`.

On peut aussi, si `data/nominaux.json` a été écrit par `/armer` :

```bash
npm run start -- panique --hote ADRESSE_CONSOLE
```

## 6. Déconnexion réseau

1. Relancer `servir`, armer, envoyer un tick.
2. Débrancher le câble réseau de la console, ou couper le lien.
3. Attendu : le processus ne doit pas inventer d'écritures hors ligne. Les faders restent où la dernière trame les a laissés. Pas de rappel de scène.
4. Rebrancher. Relancer `dump`. La version est toujours `2.8.2.103375`. Reprendre seulement après un nouveau dump.

## 7. Preuve que l'AVB n'a pas changé

1. Reprendre les photos de l'étape 0 : horloge, page AVB, mode USB, 48 V, nom de scène. Tout est identique.
2. Comparer les clés sensibles :

```bash
npm run dump -- --hote ADRESSE_CONSOLE --sortie data/apres.json --comparer data/avant.json
```

3. La sortie de comparaison doit avoir `"identique": true`. Un écart sur `48v`, `avb`, `usb`, `clock`, `preset` ou `scene` est un échec : ne pas utiliser l'automix en spectacle tant que ce n'est pas expliqué. Un écart de `line/chN/volume` n'entre pas dans cette comparaison : c'est le fader, et c'est voulu.
4. Le code de sortie 2 signifie que la comparaison a trouvé une différence sensible.

## Trim

Le trim de préampli ne part pas tout seul. `POST /trim/suggestion` renvoie un jeton et un petit pas de fil (la loi dB du préampli n'est pas attestée). `POST /trim/confirmer` avec ce jeton écrit une seule fois. Refusé tant que l'automix tourne.

## Après l'essai

Si les étapes 1 à 3 montrent un écart de plusieurs dB entre la valeur demandée et la tranche, ne pas compenser à l'oreille en spectacle. Noter la paire (dB affiché, fil lu par un dump) et l'ajouter comme calibration locale avant une autre écriture de fader.
