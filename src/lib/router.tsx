import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type MouseEvent } from "react";

/**
 * Router mínimo basado en History API (sin dependencias).
 * Rutas actuales: "/" y "/sala/:code". Para sumar rutas, extender `matchRoute`.
 */

export type Route =
  | { name: "home" }
  | { name: "start" }
  | { name: "room"; code: string }
  | { name: "not-found" };

export function matchRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { name: "home" };
  if (/^\/empezar\/?$/i.test(pathname)) return { name: "start" };
  const room = pathname.match(/^\/sala\/([^/]+)\/?$/i);
  if (room) return { name: "room", code: decodeURIComponent(room[1]).toUpperCase() };
  return { name: "not-found" };
}

type RouterValue = { route: Route; navigate: (to: string, opts?: { replace?: boolean }) => void };
const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => matchRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(matchRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    setRoute(matchRoute(new URL(to, window.location.origin).pathname));
    window.scrollTo({ top: 0 });
  }, []);

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter fuera de RouterProvider");
  return ctx;
}

export function Link({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { navigate } = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

export const roomPath = (code: string) => `/sala/${code}`;
