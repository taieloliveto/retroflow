import { useState, type FormEvent } from "react";
import { RoomError, roomsApi, toSession } from "../api";
import { CODE_LENGTH, NAME_MAX, isValidCodeShape, normalizeCode, normalizeName } from "../code";
import { saveSession } from "../session";
import type { EnterResult } from "../types";

function useEntry(onEntered: (r: EnterResult) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<EnterResult>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      saveSession(toSession(result));
      onEntered(result);
    } catch (e) {
      setError(e instanceof RoomError ? e.message : "Ocurrió un error inesperado. Probá de nuevo.");
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function ErrorMessage({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="form-error" role="alert">
      {text}
    </p>
  );
}

export function CreateRoomForm({ onEntered }: { onEntered: (r: EnterResult) => void }) {
  const [name, setName] = useState("");
  const { busy, error, setError, run } = useEntry(onEntered);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = normalizeName(name);
    if (!clean) return setError("Ingresá tu nombre para crear la sala.");
    run(() => roomsApi.create(clean));
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field__label">Tu nombre</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej.: Taiel"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          autoFocus
          disabled={busy}
        />
      </label>
      <ErrorMessage text={error} />
      <button className="btn btn--primary btn--block" disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        {busy ? "Creando sala…" : "Crear sala"}
      </button>
      <p className="form-hint">Vas a ser el PO de esta retrospectiva.</p>
    </form>
  );
}

export function JoinRoomForm({
  onEntered,
  initialCode = "",
  autoFocusName = false,
}: {
  onEntered: (r: EnterResult) => void;
  initialCode?: string;
  autoFocusName?: boolean;
}) {
  const [code, setCode] = useState(normalizeCode(initialCode));
  const [name, setName] = useState("");
  const { busy, error, setError, run } = useEntry(onEntered);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleanCode = normalizeCode(code);
    const cleanName = normalizeName(name);
    if (!cleanCode) return setError("Ingresá el código de la sala.");
    if (!isValidCodeShape(cleanCode)) return setError("El código tiene 6 caracteres entre letras y números.");
    if (!cleanName) return setError("Ingresá tu nombre para que el equipo te reconozca.");
    run(() => roomsApi.join(cleanCode, cleanName));
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field__label">Código de sala</span>
        <input
          className="input input--code"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value).slice(0, CODE_LENGTH))}
          placeholder="ABC123"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          disabled={busy}
        />
      </label>
      <label className="field">
        <span className="field__label">Tu nombre</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej.: Sofi"
          maxLength={NAME_MAX}
          autoComplete="given-name"
          autoFocus={autoFocusName}
          disabled={busy}
        />
      </label>
      <ErrorMessage text={error} />
      <button className="btn btn--dark btn--block" disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        {busy ? "Ingresando…" : "Ingresar"}
      </button>
      <p className="form-hint">¿Ya estabas en la sala? Usá el mismo nombre para recuperar tu lugar.</p>
    </form>
  );
}
