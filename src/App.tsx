import { Logo } from "./components/Logo";
import { ToastProvider } from "./components/Toasts";
import { isSupabaseConfigured } from "./lib/supabase";
import { Link, RouterProvider, useRouter } from "./lib/router";
import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";

function Routes() {
  const { route } = useRouter();
  if (!isSupabaseConfigured) return <ConfigMissing />;
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "room":
      return <RoomPage key={route.code} code={route.code} />;
    default:
      return (
        <div className="page center-screen">
          <Logo />
          <h1 className="action-card__title">No encontramos esta página</h1>
          <Link to="/" className="btn btn--primary">
            Ir al inicio
          </Link>
        </div>
      );
  }
}

function ConfigMissing() {
  return (
    <div className="page center-screen">
      <Logo />
      <article className="action-card finished-card">
        <h1 className="action-card__title">Falta conectar Supabase</h1>
        <p className="action-card__text">
          Definí <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en <code>.env.local</code> (local) o
          en las variables de entorno de Vercel, y volvé a desplegar.
        </p>
      </article>
    </div>
  );
}

export default function App() {
  return (
    <RouterProvider>
      <ToastProvider>
        <Routes />
      </ToastProvider>
    </RouterProvider>
  );
}
