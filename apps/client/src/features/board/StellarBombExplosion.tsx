import { memo, useEffect, useMemo, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

let engineReady: Promise<void> | null = null;

function ensureParticlesEngine() {
  engineReady ||= initParticlesEngine(async (engine) => {
    await loadSlim(engine);
  }).then(() => {});
  return engineReady;
}

export default memo(function StellarBombExplosion({
  id,
  reducedMotion = false,
}: {
  id: string;
  reducedMotion?: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    ensureParticlesEngine().then(() => {
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
      detectRetina: true,
      fpsLimit: reducedMotion ? 30 : 60,
      particles: {
        number: { value: 0 },
      },
      emitters: {
        position: { x: 50, y: 50 },
        size: { width: 0, height: 0 },
        rate: { quantity: 0, delay: 0.1 },
        life: { count: 1, duration: 0.1, delay: 0 },
        startCount: reducedMotion ? 70 : 160,
        particles: {
          color: { value: ["#ffffff", "#ffe07a", "#ff6d6d", "#ff2d8a"] },
          shape: { type: "circle" },
          opacity: {
            value: { min: 0.25, max: 0.9 },
            animation: { enable: true, speed: 2.2, startValue: "max", destroy: "min" },
          },
          size: {
            value: { min: 1.5, max: 4.5 },
            animation: { enable: true, speed: 14, startValue: "max", destroy: "min" },
          },
          move: {
            enable: !reducedMotion,
            speed: { min: 8, max: 22 },
            direction: "none",
            random: false,
            straight: false,
            outModes: { default: "destroy" },
            center: { x: 50, y: 50 },
          },
        },
      },
      interactivity: {
        events: {
          onHover: { enable: false },
          resize: { enable: true },
        },
      },
    }),
    [reducedMotion]
  );

  if (!ready) return null;

  return <Particles id={id} options={options} />;
});
