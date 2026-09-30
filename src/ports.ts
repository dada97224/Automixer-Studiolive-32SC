import { PORT_CONTROLE, PORTS_AVB_INTERDITS } from "./constantes.js";

export class PortRefuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortRefuseError";
  }
}

export function assertPortControle(port: number): void {
  if (port !== PORT_CONTROLE) {
    throw new PortRefuseError(`port TCP ${port} refusé : seul ${PORT_CONTROLE} (Control) est autorisé`);
  }
  if ((PORTS_AVB_INTERDITS as readonly number[]).includes(port)) {
    throw new PortRefuseError(`port AVB ${port} refusé`);
  }
}

export function assertPortMesure(port: number): void {
  if (port === PORT_CONTROLE || (PORTS_AVB_INTERDITS as readonly number[]).includes(port)) {
    throw new PortRefuseError(`port UDP ${port} refusé pour la mesure`);
  }
  if (port < 0 || port > 65535) {
    throw new PortRefuseError(`port UDP ${port} invalide`);
  }
}
