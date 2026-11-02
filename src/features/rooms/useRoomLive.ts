import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRoomChannel } from "../../lib/realtime/useRoomChannel";
import { RoomError, roomsApi } from "./api";
import type { Card, EnterResult, Participant, PhaseProgress, ReviewState, Room, RoomState, Session } from "./types";

const HEARTBEAT_MS = 20_000;
/** Durante la retro se refresca más seguido como respaldo de los eventos en tiempo real. */
const HEARTBEAT_IN_PROGRESS_MS = 8_000;
const EMPTY_PROGRESS: PhaseProgress = {
  destacar: { cards: 0, contributors: 0 },
  mejorar: { cards: 0, contributors: 0 },
  mantener: { cards: 0, contributors: 0 },
};

export type RoomNotice = { kind: "join" | "leave" | "info"; text: string };

/**
 * Estado vivo de una sala: datos persistidos (Postgres) + presencia (Realtime).
 *
 *  - La lista de integrantes sale de la base (fuente de verdad).
 *  - El indicador "conectado" sale de Presence.
 *  - Cuando aparece alguien que no estaba en la lista, o llega un evento,
 *    se vuelve a pedir el estado. Además hay un latido cada 20 s.
 */
export function useRoomLive(session: Session, initial: EnterResult, notify: (n: RoomNotice) => void) {
  const [room, setRoom] = useState<Room>(initial.room);
  const [participants, setParticipants] = useState<Participant[]>([initial.participant]);
  const [sessionLost, setSessionLost] = useState(false);
  const [myCards, setMyCards] = useState<Card[]>([]);
  const [progress, setProgress] = useState<PhaseProgress>(EMPTY_PROGRESS);
  const [contributors, setContributors] = useState(0);
  /** true cuando ya llegó el estado completo (tarjetas, progreso, timer) del servidor. */
  const [hydrated, setHydrated] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  // Diferencia entre el reloj del servidor y el local (ms). Se guarda la
  // muestra con menor latencia, que es la más precisa.
  const [serverOffset, setServerOffset] = useState(0);
  const bestRtt = useRef(Infinity);

  const me = participants.find((p) => p.id === session.participantId) ?? initial.participant;
  const channel = useRoomChannel(room.id, {
    participantId: me.id,
    name: me.name,
    role: me.role,
    onlineAt: "",
  });

  /** Aplica un estado recibido del servidor (de un refresco o de una acción). */
  // Las respuestas pueden llegar desordenadas: solo se aplica la más nueva.
  const reqSeq = useRef(0);
  const appliedSeq = useRef(0);
  const applyState = useCallback((state: RoomState, sentAt?: number, seq?: number) => {
    if (seq !== undefined) {
      if (seq < appliedSeq.current) return;
      appliedSeq.current = seq;
    }
    setRoom(state.room);
    setParticipants(state.participants);
    setMyCards(state.myCards ?? []);
    setProgress(state.progress ?? EMPTY_PROGRESS);
    setContributors(state.contributors ?? 0);
    setReview(state.review ?? null);
    setHydrated(true);
    if (state.serverNow && sentAt !== undefined) {
      const now = Date.now();
      const rtt = now - sentAt;
      if (rtt <= bestRtt.current + 50) {
        bestRtt.current = Math.min(bestRtt.current, rtt);
        setServerOffset(new Date(state.serverNow).getTime() + rtt / 2 - now);
      }
    }
  }, []);

  /** Ejecuta una acción que devuelve el estado y lo aplica midiendo el reloj. */
  const runAction = useCallback(
    async (fn: () => Promise<RoomState>) => {
      const seq = ++reqSeq.current;
      const sentAt = Date.now();
      const state = await fn();
      applyState(state, sentAt, seq);
      return state;
    },
    [applyState],
  );

  // --- Sincronización con la base (con coalescencia de pedidos simultáneos) ---
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      do {
        again.current = false;
        try {
          const seq = ++reqSeq.current;
          const sentAt = Date.now();
          const state = await roomsApi.getState(session);
          applyState(state, sentAt, seq);
        } catch (e) {
          if (e instanceof RoomError && e.code === "SESSION_INVALID") setSessionLost(true);
        }
      } while (again.current);
    })().finally(() => {
      inflight.current = null;
    });
    return inflight.current;
  }, [session, applyState]);

  const inProgress = room.status === "in_progress";
  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, inProgress ? HEARTBEAT_IN_PROGRESS_MS : HEARTBEAT_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, inProgress]);

  // Al (re)conectar el canal: refrescar y avisar a los demás.
  useEffect(() => {
    if (channel.status !== "online") return;
    refresh();
    channel.send("participant:joined", { participantId: me.id, name: me.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.status]);

  // --- Eventos broadcast ---
  const leftIds = useRef(new Set<string>());
  useEffect(() => {
    const offJoin = channel.on("participant:joined", () => refresh());
    const offLeft = channel.on("participant:left", ({ participantId, name }) => {
      leftIds.current.add(participantId);
      setParticipants((list) => list.filter((p) => p.id !== participantId));
      notify({ kind: "leave", text: `${name} salió de la sala` });
      refresh();
    });
    const offRoom = channel.on("room:updated", () => refresh());
    const offCards = channel.on("cards:changed", () => refresh());
    return () => {
      offJoin();
      offLeft();
      offRoom();
      offCards();
    };
  }, [channel.on, refresh, notify]);

  // --- Presencia: detectar altas, desconexiones y reconexiones ---
  const knownIds = useRef(new Set<string>());
  useEffect(() => {
    participants.forEach((p) => knownIds.current.add(p.id));
  }, [participants]);

  const prevOnline = useRef<Map<string, unknown> | null>(null);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    const online = channel.online;
    if (!online) return;
    const prev = prevOnline.current;
    prevOnline.current = online;

    const listed = new Set(participants.map((p) => p.id));
    if ([...online.keys()].some((id) => !listed.has(id))) refresh();

    if (!prev || Date.now() - mountedAt.current < 4000) {
      online.forEach((_, id) => knownIds.current.add(id));
      return; // primera sincronización (y unos segundos de gracia): sin avisos
    }
    online.forEach((meta, id) => {
      if (prev.has(id) || id === me.id) return;
      const wasKnown = knownIds.current.has(id) && !leftIds.current.has(id);
      leftIds.current.delete(id);
      knownIds.current.add(id);
      notify({ kind: "join", text: wasKnown ? `${meta.name} se reconectó` : `${meta.name} se sumó a la sala` });
    });
    if ([...prev.keys()].some((id) => !online.has(id))) refresh();
    prev.forEach((meta, id) => {
      if (online.has(id) || id === me.id || leftIds.current.has(id)) return;
      notify({ kind: "leave", text: `${(meta as { name: string }).name} perdió la conexión` });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.online]);

  const isOnline = useCallback(
    (id: string) => (id === me.id ? channel.status === "online" : Boolean(channel.online?.has(id))),
    [channel.online, channel.status, me.id],
  );

  const connectedCount = useMemo(
    () => participants.filter((p) => isOnline(p.id)).length,
    [participants, isOnline],
  );

  // --- Acciones ---
  const { send, untrack } = channel;
  const leave = useCallback(async () => {
    // Primero se registra en la base y después se avisa: así quien refresque
    // al recibir el evento ya no ve a esta persona.
    try {
      await roomsApi.leave(session);
    } finally {
      await send("participant:left", { participantId: me.id, name: me.name }).catch(() => undefined);
      await untrack().catch(() => undefined);
    }
  }, [send, untrack, me.id, me.name, session]);

  const finish = useCallback(async () => {
    const updated = await roomsApi.finish(session);
    setRoom(updated);
    await send("room:updated", { status: updated.status }).catch(() => undefined);
  }, [send, session]);

  return {
    room,
    participants,
    me,
    isPO: me.role === "po",
    isOnline,
    connectedCount,
    connection: channel.status,
    sessionLost,
    leave,
    finish,
    refresh,
    // Módulo 2
    hydrated,
    // Módulo 3
    review,
    myCards,
    progress,
    contributors,
    serverOffset,
    runAction,
    session,
    /** Expuesto para que los módulos futuros escuchen/emitan sus propios eventos. */
    channel,
  };
}

export type RoomLive = ReturnType<typeof useRoomLive>;
