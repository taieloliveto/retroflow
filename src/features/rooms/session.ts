import type { Session } from "./types";

/**
 * Sesión persistente por sala: permite recargar la página o cerrar la pestaña
 * y volver sin crear un participante duplicado.
 */
const key = (code: string) => `retroflow:session:${code.toUpperCase()}`;

export function loadSession(code: string): Session | null {
  try {
    const raw = window.localStorage.getItem(key(code));
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && s.participantId && s.token ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  try {
    window.localStorage.setItem(key(session.roomCode), JSON.stringify(session));
  } catch {
    /* modo privado sin storage: la sesión vive solo en memoria */
  }
}

export function clearSession(code: string) {
  try {
    window.localStorage.removeItem(key(code));
  } catch {
    /* noop */
  }
}
