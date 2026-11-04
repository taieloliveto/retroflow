import { downloadXlsx, type SheetSpec } from "../../lib/xlsx";
import type { Commitment, CommitmentStatus, PhaseId, ReviewCard } from "../rooms/types";
import type { RoomLive } from "../rooms/useRoomLive";
import { phaseById } from "../retro/phases";

export const STATUS_LABEL: Record<CommitmentStatus, string> = {
  pending: "Pendiente",
  in_progress: "En progreso",
  done: "Completada",
};

const RANK: Record<PhaseId, number> = { destacar: 0, mejorar: 1, mantener: 2 };

/** "2026-11-20" → "20/11/2026" (sin pasar por Date para evitar corrimientos de zona horaria). */
export function formatDue(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

export const sortCards = (cards: ReviewCard[]) =>
  [...cards].sort((a, b) => RANK[a.phase] - RANK[b.phase] || a.order - b.order);

/**
 * Filas del resultado: Tipo, Título, Descripción, Accionable, Responsable, Plazo, Estado.
 * Orden: primero los compromisos; después las tarjetas sin compromiso que tienen
 * accionables registrados en la revisión; al final las que no tienen nada.
 */
export function resultRows(cards: ReviewCard[], commitments: Commitment[]) {
  const withCommitments: string[][] = [];
  const withNotes: string[][] = [];
  const rest: string[][] = [];
  for (const c of sortCards(cards)) {
    const tipo = phaseById(c.phase).name;
    const mine = commitments.filter((m) => m.cardId === c.id);
    if (mine.length) {
      for (const m of mine)
        withCommitments.push([tipo, c.title, c.body, m.action, m.owners.join(", "), formatDue(m.dueDate), STATUS_LABEL[m.status]]);
    } else if (c.notes.trim()) {
      withNotes.push([tipo, c.title, c.body, c.notes.trim(), "", "", "Sin compromiso"]);
    } else {
      rest.push([tipo, c.title, c.body, "", "", "", "Sin compromiso"]);
    }
  }
  return [...withCommitments, ...withNotes, ...rest];
}

export function downloadRetroResult(live: RoomLive) {
  const cards = live.review?.cards ?? [];
  const commitments = live.commitments ?? [];
  const title = live.room.title ?? `Retrospectiva ${live.room.code}`;
  // Fecha local (no UTC): una retro cerrada a la noche no queda con la fecha del día siguiente.
  const d = new Date(live.room.finishedAt ?? live.room.createdAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const result: SheetSpec = {
    name: "Resultado",
    columns: [
      { header: "Tipo", width: 12 },
      { header: "Título del punto levantado", width: 34 },
      { header: "Descripción del punto levantado", width: 50 },
      { header: "Accionable", width: 50 },
      { header: "Responsable", width: 26 },
      { header: "Plazo", width: 12 },
      { header: "Estado", width: 15 },
    ],
    rows: resultRows(cards, commitments),
  };

  const withOwner = commitments.filter((m) => m.owners.length > 0).length;
  const info: SheetSpec = {
    name: "Datos de la retro",
    columns: [
      { header: "Dato", width: 30 },
      { header: "Valor", width: 50 },
    ],
    rows: [
      ["Retrospectiva", title],
      ["Código de sala", live.room.code],
      ["Fecha", formatDue(date)],
      ["PO", live.room.poName ?? ""],
      ["Participantes", live.participants.map((p) => p.name).join(", ")],
      ["Tarjetas de Destacar", cards.filter((c) => c.phase === "destacar").length],
      ["Tarjetas de Mejorar", cards.filter((c) => c.phase === "mejorar").length],
      ["Tarjetas de Mantener", cards.filter((c) => c.phase === "mantener").length],
      ["Compromisos", commitments.length],
      ["Compromisos con responsable", withOwner],
      ["Compromisos con fecha objetivo", commitments.filter((m) => m.dueDate).length],
    ],
  };

  const safe = title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-") || live.room.code;
  downloadXlsx(`Retronadas-${safe}-${date}.xlsx`, [result, info]);
}
