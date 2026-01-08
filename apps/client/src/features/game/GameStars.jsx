import { memo, useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

function GameStars() {
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

  const options = useMemo(
    () => ({
      fullScreen: { enable: false },
      background: { color: { value: "transparent" } },
      fpsLimit: reducedMotion ? 30 : 60,
      detectRetina: true,
      particles: {
        // Reduced from 60 to 25 for better performance during gameplay
        number: { value: 25, density: { enable: true, area: 1200 } },
        color: { value: ["#ffffff", "#74f2ff", "#6cf7b2"] },
        shape: { type: "circle" },
        opacity: { value: { min: 0.15, max: 0.5 } },
        size: { value: { min: 0.4, max: 1.4 } },
        links: {
          // Disabled links during gameplay - O(n²) calculation is expensive
          enable: false,
        },
        move: {
          enable: !reducedMotion,
          speed: 0.15,
          direction: "none",
          random: true,
          straight: false,
          outModes: { default: "out" },
        },
      },
      interactivity: {
        events: {
          onHover: { enable: false },
          resize: true,
        },
      },
    }),
    [reducedMotion]
  );

  if (!ready) return null;

  return (
    <Particles
      id="game-stars"
      className="game-stars"
      options={options}
    />
  );
}

export default memo(GameStars);
