/**
 * Tipos del dominio de salas. Los módulos futuros (fases, tarjetas, timers,
 * planes de acción) cuelgan de `Room.id` y reutilizan `Participant` y `Session`.
 */

export type RoomStatus = "waiting" | "in_progress" | "finished";
export type Role = "po" | "collaborator";

/** Fases de carga (módulo 2). El orden es fijo y lo garantiza la base. */
export type PhaseId = "destacar" | "mejorar" | "mantener";
/**
 * "done" = terminó la carga · "review" = revisión en curso (módulo 3) ·
 * "review_done" = resumen final de la revisión.
 */
export type CurrentPhase =
  | PhaseId
  | "done"
  | "review"
  | "review_done"
  /** Módulo 4: definición de compromisos y retro cerrada. */
  | "commitments"
  | "closed"
  | null;

export type CommitmentStatus = "pending" | "in_progress" | "done";

export interface Commitment {
  id: string;
  /** Tarjeta de la que surge. */
  cardId: string;
  action: string;
  /** Nombres de integrantes de la sala o de personas externas. */
  owners: string[];
  /** "AAAA-MM-DD" o null. */
  dueDate: string | null;
  status: CommitmentStatus;
  createdAt: string;
}

/** Módulo 3 · Revisión */
export type ReviewStatus = "pending" | "in_review" | "reviewed";

export interface ReviewCard {
  id: string;
  phase: PhaseId;
  /** Posición dentro de su categoría (orden aleatorio fijo). */
  order: number;
  title: string;
  body: string;
  anonymous: boolean;
  /** Nombre del autor, solo si la tarjeta NO es anónima. */
  authorName: string | null;
  status: ReviewStatus;
  needsAction: boolean;
  /** "Accionables" registrados por el PO. */
  notes: string;
}

export interface ReviewState {
  category: PhaseId;
  /** Categoría más avanzada alcanzada. */
  reached: PhaseId;
  /** Tarjeta en pantalla; null = resumen de la categoría. */
  cardId: string | null;
  cards: ReviewCard[];
}
export type PhaseStatus = "active" | "closed" | null;

export interface RoomTimer {
  /** Momento (hora del servidor) en que vence. null = en pausa o sin timer. */
  endsAt: string | null;
  /** Tiempo restante congelado mientras está en pausa. */
  remainingMs: number | null;
  /** Duración total de la fase, incluyendo extensiones (para la barra de progreso). */
  totalMs: number | null;
}

export interface Card {
  id: string;
  phase: PhaseId;
  title: string;
  body: string;
  anonymous: boolean;
  createdAt: string;
}

export type PhaseProgress = Record<PhaseId, { cards: number; contributors: number }>;

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  /** Nombre opcional definido por el PO. */
  title: string | null;
  currentPhase: CurrentPhase;
  phaseStatus: PhaseStatus;
  /** Duración de cada fase en segundos. */
  durations: Record<PhaseId, number>;
  timer: RoomTimer;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  poName: string | null;
}

export interface Participant {
  id: string;
  name: string;
  role: Role;
  joinedAt: string;
}

/** Lo que el navegador guarda para recuperar la sesión al recargar. */
export interface Session {
  roomCode: string;
  roomId: string;
  participantId: string;
  token: string;
  name: string;
}

export interface EnterResult {
  room: Room;
  participant: Participant;
  token: string;
  reconnected: boolean;
}

export interface RoomState {
  room: Room;
  participants: Participant[];
  /** Hora del servidor al responder: referencia única para los timers. */
  serverNow: string;
  /** Solo las tarjetas propias: nunca llegan tarjetas ajenas al navegador. */
  myCards: Card[];
  progress: PhaseProgress;
  /** Cantidad de personas que aportaron al menos una tarjeta. */
  contributors: number;
  /** Solo durante la revisión y después (módulo 3). */
  review?: ReviewState | null;
  /** Solo durante la definición de compromisos y el cierre (módulo 4). */
  commitments?: Commitment[] | null;
}
