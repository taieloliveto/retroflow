# RetroFlow

Plataforma web para retrospectivas Scrum virtuales.

- **Módulo 1 · Salas:** landing, creación de salas, ingreso por código, identificación de participantes,
  sala de espera con participantes en tiempo real y rol de PO automático para quien crea la sala.
- **Módulo 2 · Carga de tarjetas:** configuración de la retro (nombre y tiempos), inicio sincronizado,
  fases Destacar → Mejorar → Mantener con timer centralizado, tarjetas con anonimato real,
  transiciones controladas por el PO y resumen final de carga.
- **Módulo 3 · Revisión de tarjetas:** mezcla aleatoria por categoría, una tarjeta a la vez para todos,
  navegación del PO, Accionables, marca "Generar acción", estados de revisión y resúmenes.
- **Módulo 4 · Definición de compromisos:** a partir de las tarjetas marcadas, el PO define compromisos
  (acción, responsables internos o externos, fecha objetivo y estado), cierra la retro y descarga el
  resultado en Excel (.xlsx).

**Stack (todo gratuito):** React + Vite + TypeScript · Supabase (Postgres + Realtime, plan Free) · Vercel (plan Hobby).

---

## Puesta en marcha (≈15 minutos)

### 1. Supabase
1. Creá una cuenta en <https://supabase.com> y un proyecto nuevo (plan Free).
2. Andá a **SQL Editor → New query** y ejecutá los scripts de `supabase/migrations/` **en orden**,
   pegando cada uno completo y tocando **Run**:
   1. `0001_salas.sql`
   2. `0002_fases_tarjetas.sql`
   3. `0003_revision.sql`
   4. `0004_compromisos.sql`

   Se pueden volver a ejecutar sin problemas, pero siempre en ese orden: si volvés a correr una,
   corré también todas las siguientes.
3. Andá a **Project Settings → API** y copiá:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / publishable key** → `VITE_SUPABASE_ANON_KEY` (es pública por diseño; nunca uses la `service_role`).
4. Realtime: no hace falta activar nada. Si en **Realtime → Settings** ves la opción
   *"Allow public access"* (o "Private channels only"), dejá habilitado el acceso público.

### 2. Probar en tu computadora (opcional)
```bash
npm install
cp .env.example .env.local   # y completá las dos variables
npm run dev                  # http://localhost:5173
```
Para simular varias personas, abrí la sala en ventanas de incógnito o en navegadores distintos
(cada navegador guarda su propia sesión).

### 3. GitHub
```bash
git init
git add .
git commit -m "RetroFlow: módulo 1 (salas)"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/retroflow.git
git push -u origin main
```

### 4. Vercel
1. En <https://vercel.com> → **Add New → Project** → importá el repo de GitHub.
2. Vercel detecta **Vite** solo (build `npm run build`, salida `dist`).
3. En **Environment Variables** cargá `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**. Cada `git push` a `main` vuelve a desplegar automáticamente.

> Si cambiás las variables después del primer deploy, hacé **Redeploy**: Vite las incorpora al compilar.

---

## Cómo funciona

| Necesidad | Solución |
|---|---|
| Datos de salas y participantes | Tablas `rooms` y `participants` en Postgres |
| Seguridad | RLS activado sin políticas: el navegador **no** accede a las tablas. Todo pasa por funciones RPC (`security definer`) que validan las reglas |
| Quién está conectado | Supabase Realtime **Presence** (detecta cierre de pestaña, caída de red y reconexión) |
| Avisos entre participantes | Supabase Realtime **Broadcast** (`participant:joined`, `participant:left`, `room:updated`) |
| Recargar sin duplicarse | Token de sesión por sala guardado en `localStorage` (`retroflow:session:CODIGO`) |
| Volver desde otro dispositivo | Mismo **nombre + código** → recupera el mismo participante y su rol (incluido PO) |

### Reglas de negocio (aplicadas en la base, no solo en la interfaz)
- Código único de 6 caracteres sin ambiguos (sin `0 O 1 I L`), generado con aleatoriedad criptográfica.
- El creador es PO; índice único que impide un segundo PO por sala.
- Nombres únicos por sala (sin distinguir mayúsculas): el nombre es la identidad.
- Si alguien intenta entrar con un nombre que **está conectado en este momento** (actividad en los últimos 90 s),
  se rechaza con un mensaje claro. Así dos personas distintas no comparten nombre y nadie toma el lugar de
  alguien que está presente. Quien cerró la pestaña puede recuperar su lugar con su nombre pasado ese lapso
  (o al instante desde el mismo navegador, gracias al token guardado).
- Código normalizado: mayúsculas y sin espacios (`" abc 123 "` → `ABC123`).
- Sala finalizada (`status = finished`) no admite ingresos. El PO puede finalizarla desde su panel.
- Cada consulta está aislada a la sala del participante autenticado por su token.

### Funciones RPC disponibles
`create_room(name)` · `join_room(code, name)` · `resume_session(id, token)` ·
`get_room_state(id, token)` (también es el "latido") · `leave_room(id, token)` · `finish_room(id, token)` (solo PO) ·
`configure_room` (solo PO) · `start_retrospective` (solo PO) · `phase_control` (solo PO) · `add_card` ·
`start_review` (solo PO) · `review_navigate` (solo PO) · `update_card_review` (solo PO) ·
`start_commitments` · `save_commitment` · `delete_commitment` · `finish_commitments` (todas solo PO).

---

## Módulo 2 · Fases de carga

| Tema | Cómo funciona |
|---|---|
| Configuración | El PO define el nombre y los minutos de cada fase en la sala de espera (sugeridos 5/7/5, de 1 a 60). Se guarda sola en `rooms.settings` y todos la ven |
| Inicio | `start_retrospective` pasa la sala a `in_progress` y arranca Destacar. Un evento en tiempo real lleva a todos a la pantalla de la retro |
| Timer centralizado | La base guarda cuándo vence (`timer_ends_at`) o cuánto queda si está en pausa (`timer_remaining_ms`). Cada navegador mide su desfase contra la hora del servidor (`serverNow`) y solo dibuja la cuenta regresiva: todos ven lo mismo aunque sus relojes difieran |
| Controles del PO | `phase_control`: pausar, reanudar, extender (+1/+3 min), cerrar fase y avanzar. Cada acción indica la fase esperada: un doble clic o un pedido viejo nunca saltea fases |
| Tiempo cumplido | Al llegar a cero no se bloquea nada: aparece un aviso y el botón "Finalizar fase" se destaca para el PO |
| Tarjetas | `add_card` solo acepta tarjetas en la fase actual y abierta (lo valida la base, con bloqueo contra el cierre simultáneo). Cada borrador lleva un id propio: un reintento por corte de red no duplica la tarjeta |
| Privacidad | El navegador recibe solo **sus** tarjetas y contadores agregados. Las tarjetas ajenas no viajan durante la carga, y el autor de una anónima nunca se devuelve a nadie, tampoco al PO |
| Reconexión | Al recargar o reconectarse se pide el estado completo: fase, timer, tus tarjetas y el progreso. Además hay un refresco cada 8 s como respaldo |

> **Sobre el anonimato:** dentro de la app nadie puede saber quién escribió una tarjeta anónima. La base guarda
> el autor (`cards.author_id`) para mostrarte tus propias tarjetas y contar contribuciones; solo alguien con
> acceso de administrador al proyecto de Supabase podría consultarlo con SQL.

## Módulo 3 · Revisión de tarjetas

| Tema | Cómo funciona |
|---|---|
| Inicio | Desde el cierre de carga, el PO toca "Continuar a la revisión de tarjetas" (`start_review`) y todos entran a la revisión |
| Mezcla | Al iniciar, la base asigna un orden aleatorio **dentro de cada categoría** (`cards.review_order`), una sola vez. Recargar o reconectarse no lo cambia |
| Tarjeta compartida | La sala guarda la categoría y la tarjeta en pantalla (`rooms.review_category`, `rooms.review_card_id`). Todos ven exactamente eso |
| Navegación (solo PO) | `review_navigate`: **Revisada · siguiente** (marca revisada), **Saltar** (queda pendiente), **Anterior**, ir a cualquier tarjeta desde el mapa numerado, retomar pendientes y pasar de categoría. Atajos ← → en el teclado |
| Estados | `pending` / `in_review` / `reviewed`, independientes de la marca `needs_action` ("Generar acción") |
| Accionables | Notas del PO por tarjeta (`cards.po_notes`). Se guardan solas al escribir y también al cambiar de tarjeta. El resto las ve en tiempo real y no puede editarlas |
| Resúmenes | Al terminar cada categoría: total, revisadas, pendientes y para acción. Se puede seguir aunque queden pendientes y retomarlas después, incluso desde el resumen final |
| Anonimato | Recién en la revisión se comparten las tarjetas del equipo. Las anónimas llegan **sin nombre ni id de autor**, también al PO |

Las tarjetas marcadas con `needs_action = true` son las candidatas para el módulo de planes de acción.
El botón "Continuar a la conversación abierta" está listo para conectar el módulo siguiente
(`onContinueToConversation` en `RetroScreen.tsx`).

## Módulo 4 · Definición de compromisos

| Tema | Cómo funciona |
|---|---|
| Inicio | Desde el resumen de la revisión, el PO toca "Continuar a la definición de compromisos" (`start_commitments`) |
| Tarjetas | Se muestran las marcadas con "Generar acción", con su contenido original y los Accionables registrados en la revisión |
| Compromisos | Acción (arranca con el accionable), responsables de la sala o externos, fecha objetivo opcional y estado (pendiente / en progreso / completada). Se pueden crear varios por tarjeta, editarlos y eliminarlos. El id lo genera el navegador: guardar dos veces no duplica |
| Permisos | Solo el PO crea, edita y elimina (lo valida la base). Todos ven los cambios en tiempo real |
| Finalización | "Finalizar definición de compromisos" muestra un resumen (totales, con y sin responsable, con y sin fecha, tarjetas sin compromisos) y permite cerrar igual si faltan datos |
| Cierre | La sala pasa a `finished` / `closed`: todos ven el listado definitivo y nadie más puede ingresar |
| Excel | El PO descarga un .xlsx (se abre en Excel y Google Sheets). Hoja **Resultado**: Tipo, Título, Descripción, Accionable, Responsable, Plazo y Estado. Primero los compromisos, después las tarjetas sin compromiso con accionables y al final el resto. Hoja **Datos de la retro**: nombre, código, fecha, PO, participantes y totales. Se genera en el navegador, sin librerías externas (`src/lib/xlsx.ts`) |

## Estructura

```
supabase/migrations/0001_salas.sql   Salas y participantes: tablas, RLS y RPC
supabase/migrations/0002_fases_tarjetas.sql  Fases, timer y tarjetas
supabase/migrations/0003_revision.sql  Revisión: orden, estados, notas y navegación
supabase/migrations/0004_compromisos.sql  Compromisos y cierre de la retro
src/
  lib/
    supabase.ts                      Cliente Supabase
    router.tsx                       Router mínimo (/, /sala/:codigo)
    realtime/useRoomChannel.ts       Canal de sala: presencia + eventos tipados
    clipboard.ts                     Copiar código/enlace, formato de fecha
  features/rooms/
    api.ts                           Llamadas RPC + mensajes de error
    useRoomLive.ts                   Estado vivo de la sala (base + presencia)
    session.ts                       Sesión persistente por sala
    components/EntryForms.tsx        Formularios crear / ingresar
    components/WaitingRoom.tsx       Sala de espera + panel del PO
  features/retro/                    Módulo 2
    api.ts                           RPC de configuración, inicio, control de fases y tarjetas
    phases.ts                        Definición y orden de las fases (textos, colores)
    useCountdown.ts                  Cuenta regresiva con la hora del servidor
    components/RetroSetup.tsx        Configuración previa del PO
    components/RetroScreen.tsx       Pantalla de la retro: fase, transición y cierre
    components/PhaseTimer.tsx        Timer + controles del PO
    components/CardComposer.tsx      Redacción de tarjetas y anonimato
  features/review/                   Módulo 3
    ReviewScreen.tsx                 Tarjeta en pantalla, controles del PO, Accionables, resúmenes
    stats.ts                         Conteos por categoría y búsqueda de pendientes
  features/commitments/              Módulo 4
    CommitmentsScreen.tsx            Definición, editor, confirmación y cierre
    export.ts                        Armado del Excel de resultados
  lib/xlsx.ts                        Generador de .xlsx sin dependencias
  pages/HomePage.tsx, RoomPage.tsx
  styles/global.css                  Identidad visual (sin dependencias de CSS)
```

## Cómo sumar los próximos módulos sin rehacer las salas

1. **Base de datos:** nuevas tablas que referencian `rooms(id)` (p. ej. `cards`, `votes`, `action_items`,
   `timers`) y nuevas RPC que reutilizan `_rf_auth(participant_id, token)` para validar identidad y rol.
   `rooms.status`, `rooms.current_phase` y `rooms.settings` ya están reservados para la dinámica.
2. **Tiempo real:** agregar eventos a `RoomEvents` / `ROOM_EVENT_NAMES` en `useRoomChannel.ts` y escucharlos con
   `live.channel.on(...)`. El canal, la presencia y la reconexión ya están resueltos.
3. **Pantallas:** en `RoomPage.tsx` (`RoomLiveView`) hay un `switch` por `room.status`, y dentro de la retro
   `RetroScreen` elige la pantalla según `room.currentPhase`.
4. **Módulo 3 (revisión):** se conecta desde `onContinueToReview` en `RetroScreen.tsx` (hoy muestra un aviso).
   La idea es sumar un valor nuevo de `current_phase` (por ejemplo `review`) y una RPC que liste las tarjetas
   de la sala **sin autor cuando son anónimas**.

## Decisiones técnicas
- **Vite (SPA) en lugar de Next.js:** toda la lógica corre contra Supabase desde el navegador; una SPA es más
  simple, sin servidor que mantener ni costos. `vercel.json` redirige todas las rutas a `index.html`.
- **Sin Supabase Auth:** el ingreso es por nombre + código, como se pidió. El token de sesión evita que otra
  persona actúe en tu nombre mientras estás conectado.
- **Sin librerías de UI ni de ruteo:** menos dependencias y menos superficie de actualización.
- `npm run build` no corre el chequeo de tipos para no bloquear despliegues; usá `npm run typecheck` en desarrollo.
