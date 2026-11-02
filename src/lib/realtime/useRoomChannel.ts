import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../supabase";
import type { Role, RoomStatus } from "../../features/rooms/types";

/**
 * Canal en tiempo real de una sala (Supabase Realtime: Presence + Broadcast).
 *
 *  - Presence: quién está conectado AHORA (se actualiza solo al cerrar la
 *    pestaña, perder la red o volver a conectarse).
 *  - Broadcast: eventos efímeros entre participantes.
 *
 * Para módulos futuros (tarjetas, timers, votos…) alcanza con sumar el evento
 * a `RoomEvents` y a `ROOM_EVENT_NAMES`, y escucharlo con `on(...)`.
 */

export interface PresenceMeta {
  participantId: string;
  name: string;
  role: Role;
  onlineAt: string;
}

export interface RoomEvents {
  "participant:joined": { participantId: string; name: string };
  "participant:left": { participantId: string; name: string };
  "room:updated": { status: RoomStatus };
  /** Alguien agregó una tarjeta (sin contenido: solo dispara el refresco de contadores). */
  "cards:changed": Record<string, never>;
}
export type RoomEventName = keyof RoomEvents;
export const ROOM_EVENT_NAMES: RoomEventName[] = ["participant:joined", "participant:left", "room:updated", "cards:changed"];

export type ConnectionStatus = "connecting" | "online" | "offline";

type Handler<K extends RoomEventName> = (payload: RoomEvents[K]) => void;

export function useRoomChannel(roomId: string, me: PresenceMeta) {
  // null hasta la primera sincronización de presencia.
  const [online, setOnline] = useState<Map<string, PresenceMeta> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const handlers = useRef(new Map<RoomEventName, Set<Handler<any>>>());
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    const supabase = getSupabase();
    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: me.participantId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const next = new Map<string, PresenceMeta>();
      for (const [key, metas] of Object.entries(state)) {
        const meta = metas[0];
        if (meta) next.set(key, { participantId: key, name: meta.name, role: meta.role, onlineAt: meta.onlineAt });
      }
      setOnline(next);
    });

    for (const name of ROOM_EVENT_NAMES) {
      channel.on("broadcast", { event: name }, (msg) => {
        handlers.current.get(name)?.forEach((h) => h(msg.payload));
      });
    }

    channel.subscribe(async (s) => {
      if (s === "SUBSCRIBED") {
        setStatus("online");
        await channel.track({ ...meRef.current, onlineAt: new Date().toISOString() });
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        setStatus("offline");
      }
    });

    return () => {
      channelRef.current = null;
      channel.untrack().catch(() => undefined);
      supabase.removeChannel(channel);
    };
    // `attempt` fuerza a recrear el canal si quedó caído demasiado tiempo.
  }, [roomId, me.participantId, attempt]);

  // Autorecuperación: si el canal sigue caído 8 s, se recrea desde cero.
  useEffect(() => {
    if (status === "online") return;
    const t = window.setTimeout(() => {
      if (navigator.onLine) {
        setStatus("connecting");
        setAttempt((a) => a + 1);
      }
    }, 8000);
    const onOnline = () => {
      setStatus("connecting");
      setAttempt((a) => a + 1);
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("online", onOnline);
    };
  }, [status, attempt]);

  useEffect(() => {
    const off = () => setStatus("offline");
    window.addEventListener("offline", off);
    return () => window.removeEventListener("offline", off);
  }, []);

  const on = useCallback(<K extends RoomEventName>(event: K, handler: Handler<K>) => {
    let set = handlers.current.get(event);
    if (!set) handlers.current.set(event, (set = new Set()));
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }, []);

  const send = useCallback(async <K extends RoomEventName>(event: K, payload: RoomEvents[K]) => {
    await channelRef.current?.send({ type: "broadcast", event, payload });
  }, []);

  const untrack = useCallback(async () => {
    await channelRef.current?.untrack();
  }, []);

  return { online, status, on, send, untrack };
}
