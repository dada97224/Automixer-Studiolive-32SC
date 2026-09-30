/**
 * Firmware figé. Le passage vers AVB Milan casse l'écosystème actuel :
 * aucune mise à jour ne doit être proposée ni déclenchée.
 */
export const VERSION_FIRMWARE_EXIGEE = "2.8.2.103375";

/** Port Control UCNET. Seul port TCP autorisé vers la console. */
export const PORT_CONTROLE = 53000;

/**
 * Ports AVB / Milan / PTP. Jamais utilisés pour le pilotage ni la mesure.
 * 319-320 : PTP. 17220-17224 : AVDECC / Milan.
 */
export const PORTS_AVB_INTERDITS = [319, 320, 17220, 17221, 17222, 17223, 17224] as const;

/** Décalage maximal sous le nominal opérateur, en dB. */
export const ATTENUATION_MAX_DB = 12;

/** En dessous de cet écart, le fader n'est pas réécrit. */
export const ZONE_MORTE_DB = 0.25;

/** Constante de temps du lissage, en millisecondes. */
export const LISSAGE_MS = 80;

/** Seuil sous lequel un micro est considéré fermé, en dB. */
export const SEUIL_OUVERTURE_DB = -45;

/**
 * Plage de range du gate pour la parole.
 * Le manuel Series III (§6.4.1) indique que Range est inactif quand
 * l'expander est engagé. On borne donc le range du mode gate, qui est
 * le réglage attesté pour une atténuation douce du bruit de fond.
 */
export const RANGE_PAROLE_MIN_DB = -20;
export const RANGE_PAROLE_MAX_DB = -12;

export const CANAL_MIN = 1;
export const CANAL_MAX = 32;

/** HTTP d'appoint, uniquement en local. */
export const HOTE_HTTP = "127.0.0.1";
export const PORT_HTTP = 8787;
