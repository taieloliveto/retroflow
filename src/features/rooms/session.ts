import type { Session } from "./types";

/**
 * Sesión persistente por sala: permite recargar la página o cerrar la pestaña
 * y volver sin crear un participante duplicado.
 *
 * Se guarda en dos lugares:
 *  - sessionStorage (por PESTAÑA): es la que manda al recargar. Así, si en el
 *    mismo navegador hay una pestaña del PO y otra de un participante, cada una
 *    recupera su propia identidad y el PO nunca pierde su rol.
 *  - localStorage (por NAVEGADOR): respaldo para cuando se cierra la pestaña y
 *    se vuelve a abrir el enlace más tarde.
 */
const key = (code: string) => `retroflow:session:${code.toUpperCase()}`;

function read(storage: Storage, code: string): Session | null {
  try {
    const raw = storage.getItem(key(code));
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && s.participantId && s.token ? s : null;
  } catch {
    return null;
  }
}

export function loadSession(code: string): Session | null {
  return read(window.sessionStorage, code) ?? read(window.localStorage, code);
}

export function saveSession(session: Session) {
  const value = JSON.stringify(session);
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.setItem(key(session.roomCode), value);
    } catch {
      /* modo privado sin storage: la sesión vive solo en memoria */
    }
  }
}

export function clearSession(code: string) {
  // En localStorage solo se borra si es la misma sesión de esta pestaña
  // (otra pestaña del mismo navegador pudo haber guardado la suya).
  const mine = read(window.sessionStorage, code);
  const shared = read(window.localStorage, code);
  const keepShared = Boolean(mine && shared && mine.participantId !== shared.participantId);
  try {
    window.sessionStorage.removeItem(key(code));
    if (!keepShared) window.localStorage.removeItem(key(code));
  } catch {
    /* noop */
  }
}
