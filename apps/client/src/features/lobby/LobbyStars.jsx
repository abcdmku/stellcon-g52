import { useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

export default function LobbyStars() {
  const [ready, setReady] = useState(false);
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  useEffect(() => {
    let mounted = true;

    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => {
      if (mounted) setReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) return null;

  return (
    <Particles
      id="lobby-stars"
      className="lobby-stars"
      options={{
        fullScreen: { enable: false },
        background: { color: { value: "transparent" } },
        fpsLimit: reducedMotion ? 30 : 60,
        detectRetina: true,
        particles: {
          number: { value: 90, density: { enable: true, area: 900 } },
          color: { value: ["#ffffff", "#74f2ff", "#6cf7b2"] },
          shape: { type: "circle" },
          opacity: { value: { min: 0.25, max: 0.9 } },
          size: { value: { min: 0.6, max: 2.2 } },
          links: {
            enable: true,
            distance: 150,
            color: "#74f2ff",
            opacity: 0.12,
            width: 1,
          },
          move: {
            enable: !reducedMotion,
            speed: 0.35,
            direction: "none",
            random: true,
            straight: false,
            outModes: { default: "out" },
          },
        },
        interactivity: {
          events: {
            onHover: { enable: true, mode: "grab" },
            resize: true,
          },
          modes: {
            grab: { distance: 220, links: { opacity: 0.28 } },
          },
        },
      }}
    />
  );
}
