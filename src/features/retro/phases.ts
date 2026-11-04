import type { PhaseId } from "../rooms/types";

/** Definición de las fases de carga. El orden es fijo (también en la base). */
export interface PhaseDef {
  id: PhaseId;
  number: 1 | 2 | 3;
  name: string;
  verb: string;
  question: string;
  /** Clase CSS de color (identidad Retronadas): teal, coral, mostaza. */
  tone: "teal" | "coral" | "mustard";
  /** Textos de la pantalla de transición al terminar esta fase. */
  doneTitle: string;
  nextLine?: string;
}

export const PHASES: PhaseDef[] = [
  {
    id: "destacar",
    number: 1,
    name: "Destacar",
    verb: "destacar",
    question: "¿Qué cosas salieron especialmente bien durante este sprint o período y vale la pena destacar?",
    tone: "teal",
    doneTitle: "¡Terminamos de destacar!",
    nextLine: "Ahora vamos a identificar qué podemos mejorar.",
  },
  {
    id: "mejorar",
    number: 2,
    name: "Mejorar",
    verb: "mejorar",
    question: "¿Qué cosas no funcionaron como esperábamos o podríamos hacer mejor?",
    tone: "coral",
    doneTitle: "¡Terminamos de pensar qué mejorar!",
    nextLine: "Ahora vamos a definir qué queremos mantener.",
  },
  {
    id: "mantener",
    number: 3,
    name: "Mantener",
    verb: "mantener",
    question: "¿Qué prácticas, dinámicas o comportamientos deberíamos mantener porque nos aportan valor?",
    tone: "mustard",
    doneTitle: "¡Terminamos de mantener!",
  },
];

export const phaseById = (id: PhaseId) => PHASES.find((p) => p.id === id)!;
export const nextPhase = (id: PhaseId) => PHASES[PHASES.findIndex((p) => p.id === id) + 1] ?? null;

export const DEFAULT_DURATIONS: Record<PhaseId, number> = { destacar: 300, mejorar: 420, mantener: 300 };
