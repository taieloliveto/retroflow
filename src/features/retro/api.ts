import { rpc } from "../rooms/api";
import type { CommitmentStatus, PhaseId, RoomState, Session } from "../rooms/types";

/**
 * RPC del módulo 2. Todas devuelven el estado completo de la sala para
 * aplicarlo de inmediato en quien hizo la acción.
 */
type Auth = Pick<Session, "participantId" | "token">;
const auth = (s: Auth) => ({ p_participant_id: s.participantId, p_token: s.token });

export type PhaseAction = "pause" | "resume" | "extend" | "close" | "next";
export type ReviewAction = "next" | "skip" | "prev" | "goto" | "next_category" | "finish";

export const retroApi = {
  configure: (s: Auth, title: string, durations: Record<PhaseId, number>) =>
    rpc<RoomState>("configure_room", { ...auth(s), p_title: title, p_durations: durations }),

  start: (s: Auth) => rpc<RoomState>("start_retrospective", auth(s)),

  control: (s: Auth, action: PhaseAction, phase: PhaseId, seconds?: number) =>
    rpc<RoomState>("phase_control", { ...auth(s), p_action: action, p_phase: phase, p_seconds: seconds ?? null }),

  // --- Módulo 3 · Revisión ---
  startReview: (s: Auth) => rpc<RoomState>("start_review", auth(s)),

  /** `expectedCategory` / `expectedCard`: lo que ve el PO (evita dobles clics). */
  reviewNavigate: (
    s: Auth,
    action: ReviewAction,
    expectedCategory: PhaseId,
    expectedCard: string | null,
    target?: string,
  ) =>
    rpc<RoomState>("review_navigate", {
      ...auth(s),
      p_action: action,
      p_expected_category: expectedCategory,
      p_expected_card: expectedCard,
      p_target: target ?? null,
    }),

  updateCardReview: (s: Auth, cardId: string, change: { notes?: string; needsAction?: boolean }) =>
    rpc<RoomState>("update_card_review", {
      ...auth(s),
      p_card: cardId,
      p_notes: change.notes ?? null,
      p_needs_action: change.needsAction ?? null,
    }),

  // --- Módulo 4 · Compromisos ---
  startCommitments: (s: Auth) => rpc<RoomState>("start_commitments", auth(s)),

  /** Crea o edita (el id lo genera el navegador: reintentar no duplica). */
  saveCommitment: (
    s: Auth,
    c: { id: string; cardId: string; action: string; owners: string[]; dueDate: string | null; status: CommitmentStatus },
  ) =>
    rpc<RoomState>("save_commitment", {
      ...auth(s),
      p_id: c.id,
      p_card: c.cardId,
      p_action: c.action,
      p_owners: c.owners,
      p_due_date: c.dueDate || null,
      p_status: c.status,
    }),

  deleteCommitment: (s: Auth, id: string) => rpc<RoomState>("delete_commitment", { ...auth(s), p_id: id }),

  finishCommitments: (s: Auth) => rpc<RoomState>("finish_commitments", auth(s)),

  addCard: (
    s: Auth,
    card: { phase: PhaseId; title: string; body: string; anonymous: boolean; clientId: string },
  ) =>
    rpc<RoomState>("add_card", {
      ...auth(s),
      p_phase: card.phase,
      p_title: card.title,
      p_body: card.body,
      p_anonymous: card.anonymous,
      p_client_id: card.clientId,
    }),
};

/** Id único para que un reintento de la misma tarjeta no la duplique. */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
