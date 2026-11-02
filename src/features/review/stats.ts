import type { PhaseId, ReviewCard, ReviewState } from "../rooms/types";

export interface ReviewStats {
  total: number;
  reviewed: number;
  pending: number;
  actions: number;
}

export function statsFor(cards: ReviewCard[]): ReviewStats {
  return {
    total: cards.length,
    reviewed: cards.filter((c) => c.status === "reviewed").length,
    // "en revisión" sin cerrar cuenta como pendiente en los resúmenes.
    pending: cards.filter((c) => c.status !== "reviewed").length,
    actions: cards.filter((c) => c.needsAction).length,
  };
}

export const cardsOf = (review: ReviewState, phase: PhaseId) =>
  review.cards.filter((c) => c.phase === phase).sort((a, b) => a.order - b.order);

const RANK: Record<PhaseId, number> = { destacar: 0, mejorar: 1, mantener: 2 };
export const rank = (p: PhaseId) => RANK[p];

/** Primera tarjeta pendiente, priorizando la categoría actual y luego las anteriores. */
export function firstPending(review: ReviewState, phase?: PhaseId): ReviewCard | null {
  const reachable = review.cards.filter((c) => rank(c.phase) <= rank(review.reached));
  const pending = (list: ReviewCard[]) =>
    list.filter((c) => c.status !== "reviewed" && c.id !== review.cardId).sort((a, b) => a.order - b.order)[0] ?? null;
  if (phase) return pending(reachable.filter((c) => c.phase === phase));
  for (const p of ["destacar", "mejorar", "mantener"] as PhaseId[]) {
    const found = pending(reachable.filter((c) => c.phase === p));
    if (found) return found;
  }
  return null;
}
