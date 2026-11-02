import { getSupabase } from "../../lib/supabase";
import type { EnterResult, Room, RoomState, Session } from "./types";

/**
 * Acceso a datos de salas. Todas las operaciones pasan por funciones RPC de
 * Postgres (ver supabase/migrations) que validan reglas de negocio y permisos.
 */

export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FINISHED"
  | "INVALID_CODE"
  | "INVALID_NAME"
  | "NAME_IN_USE"
  | "SESSION_INVALID"
  | "NOT_PO"
  | "CODE_GENERATION_FAILED"
  | "SUPABASE_NOT_CONFIGURED"
  | "ROOM_ALREADY_STARTED"
  | "ROOM_NOT_IN_PROGRESS"
  | "PHASE_CHANGED"
  | "PHASE_CLOSED"
  | "INVALID_CARD"
  | "INVALID_TITLE"
  | "INVALID_DURATION"
  | "INVALID_ACTION"
  | "DB_OUTDATED"
  | "COLLECTION_NOT_DONE"
  | "REVIEW_NOT_ACTIVE"
  | "REVIEW_CHANGED"
  | "CARD_NOT_FOUND"
  | "CATEGORY_LOCKED"
  | "NOTES_TOO_LONG"
  | "NETWORK";

const MESSAGES: Record<RoomErrorCode, string> = {
  ROOM_NOT_FOUND: "No encontramos una sala con ese código. Revisalo y probá de nuevo.",
  ROOM_FINISHED: "Esta retrospectiva ya finalizó y no admite nuevos ingresos.",
  INVALID_CODE: "El código tiene 6 caracteres entre letras y números.",
  INVALID_NAME: "Ingresá un nombre de hasta 30 caracteres.",
  NAME_IN_USE:
    "Ya hay alguien conectado con ese nombre en esta sala. Si sos vos, cerrá la otra pestaña y probá en un minuto; si no, elegí otro nombre.",
  SESSION_INVALID: "Tu sesión ya no es válida. Volvé a ingresar con tu nombre.",
  NOT_PO: "Solo el PO de la sala puede hacer esto.",
  CODE_GENERATION_FAILED: "No pudimos generar un código para la sala. Probá de nuevo.",
  SUPABASE_NOT_CONFIGURED: "Falta configurar la conexión con Supabase.",
  ROOM_ALREADY_STARTED: "La retrospectiva ya comenzó: la configuración no se puede cambiar.",
  ROOM_NOT_IN_PROGRESS: "La retrospectiva no está en curso.",
  PHASE_CHANGED: "La fase cambió. Actualizamos tu pantalla.",
  PHASE_CLOSED: "Esta fase ya cerró: la tarjeta no se pudo agregar.",
  INVALID_CARD: "La tarjeta necesita un título (hasta 120 caracteres) y un desarrollo de hasta 2000.",
  INVALID_TITLE: "El nombre de la retrospectiva puede tener hasta 60 caracteres.",
  INVALID_DURATION: "Cada fase debe durar entre 1 y 60 minutos.",
  INVALID_ACTION: "Acción no válida.",
  COLLECTION_NOT_DONE: "La revisión se puede iniciar cuando termina la carga de tarjetas.",
  REVIEW_NOT_ACTIVE: "La revisión no está en curso.",
  REVIEW_CHANGED: "La revisión avanzó. Actualizamos tu pantalla.",
  CARD_NOT_FOUND: "No encontramos esa tarjeta.",
  CATEGORY_LOCKED: "Las categorías se revisan en orden: Destacar, Mejorar y Mantener.",
  NOTES_TOO_LONG: "Los accionables pueden tener hasta 4000 caracteres.",
  DB_OUTDATED:
    "La base de datos no tiene esta función. Ejecutá las migraciones de supabase/migrations en orden y luego `notify pgrst, 'reload schema';` en el SQL Editor.",
  NETWORK: "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.",
};

export class RoomError extends Error {
  constructor(public code: RoomErrorCode) {
    super(MESSAGES[code]);
  }
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await getSupabase().rpc(fn, args);
  } catch (e) {
    if (e instanceof Error && e.message === "SUPABASE_NOT_CONFIGURED") throw new RoomError("SUPABASE_NOT_CONFIGURED");
    throw new RoomError("NETWORK");
  }
  if (res.error) {
    const msg = res.error.message ?? "";
    const pgCode = (res.error as { code?: string }).code ?? "";
    if (pgCode === "PGRST202" || msg.includes("schema cache")) {
      console.error(`[RetroFlow] RPC ${fn} no encontrada en Supabase:`, res.error);
      throw new RoomError("DB_OUTDATED");
    }
    // Se busca el código más largo primero (p. ej. ROOM_NOT_IN_PROGRESS antes que ROOM_NOT_FOUND).
    const known = (Object.keys(MESSAGES) as RoomErrorCode[])
      .sort((a, b) => b.length - a.length)
      .find((c) => msg === c || msg.includes(c));
    if (!known) console.error(`[RetroFlow] Error en RPC ${fn}:`, res.error);
    throw new RoomError(known ?? "NETWORK");
  }
  return res.data as T;
}

export const roomsApi = {
  create: (name: string) => rpc<EnterResult>("create_room", { p_name: name }),

  join: (code: string, name: string) => rpc<EnterResult>("join_room", { p_code: code, p_name: name }),

  resume: (s: Pick<Session, "participantId" | "token">) =>
    rpc<EnterResult>("resume_session", { p_participant_id: s.participantId, p_token: s.token }),

  /** Estado completo de la sala. También actúa como "latido" del participante. */
  getState: (s: Pick<Session, "participantId" | "token">) =>
    rpc<RoomState>("get_room_state", { p_participant_id: s.participantId, p_token: s.token }),

  leave: (s: Pick<Session, "participantId" | "token">) =>
    rpc<null>("leave_room", { p_participant_id: s.participantId, p_token: s.token }),

  finish: (s: Pick<Session, "participantId" | "token">) =>
    rpc<Room>("finish_room", { p_participant_id: s.participantId, p_token: s.token }),
};

export function toSession(r: EnterResult): Session {
  return {
    roomCode: r.room.code,
    roomId: r.room.id,
    participantId: r.participant.id,
    token: r.token,
    name: r.participant.name,
  };
}
