import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Pantalla completa sobre un elemento.
 *
 * El estado NO se guarda al pedir el cambio: se lee del documento en el evento
 * `fullscreenchange`. Es la única fuente que se entera de que el usuario salió
 * con Escape, de que apretó F11, o de que el navegador rechazó la petición —
 * guardar el estado a mano deja el botón mintiendo.
 */
export interface FullscreenControl {
  isFullscreen: boolean;
  toggle: () => void;
  /** `false` en un iframe sin `allow="fullscreen"`: ahí el botón sobra. */
  supported: boolean;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenControl {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported] = useState(
    () => typeof document !== "undefined" && document.fullscreenEnabled,
  );

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === ref.current);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [ref]);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const request =
      document.fullscreenElement === el
        ? document.exitFullscreen()
        : el.requestFullscreen();
    // Un permiso denegado rechaza la promesa. No hay nada que hacer salvo
    // dejar el botón como estaba; `fullscreenchange` nunca llega.
    void request.catch(() => {});
  }, [ref]);

  return { isFullscreen, toggle, supported };
}
