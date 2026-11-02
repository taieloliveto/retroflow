import type { EnterResult } from "./types";

/**
 * Resultado de crear/ingresar que se pasa a la pantalla de sala al navegar,
 * para no volver a pedirlo al servidor y poder mostrar "¡Bienvenido de nuevo!".
 */
let pending: EnterResult | null = null;

export function setPendingEntry(entry: EnterResult) {
  pending = entry;
}

export function takePendingEntry(code: string): EnterResult | null {
  if (pending && pending.room.code === code) {
    const e = pending;
    pending = null;
    return e;
  }
  return null;
}
