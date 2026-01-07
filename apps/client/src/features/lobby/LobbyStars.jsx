import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";

const audioNodesByElement = new WeakMap();

export default function LobbyStars({ audioEl = null } = {}) {
  const [ready, setReady] = useState(false);
  const containerRef = useRef(null);
  const rafRef = useRef(0);
  const particleBaseRef = useRef(new Map());
  const cleanupCanvasStylesRef = useRef(null);
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
    }),
    [reducedMotion]
  );

  const particlesLoaded = useCallback((container) => {
    containerRef.current = container || null;

    const canvas = container?.canvas?.element;
    if (!canvas) {
      cleanupCanvasStylesRef.current = null;
      return;
    }

    const previous = {
      filter: canvas.style.filter,
      transform: canvas.style.transform,
      transformOrigin: canvas.style.transformOrigin,
      willChange: canvas.style.willChange,
    };

    canvas.style.willChange = "transform, filter";

    cleanupCanvasStylesRef.current = () => {
      canvas.style.filter = previous.filter;
      canvas.style.transform = previous.transform;
      canvas.style.transformOrigin = previous.transformOrigin;
      canvas.style.willChange = previous.willChange;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (reducedMotion) return;
    if (!audioEl) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    let cancelled = false;

    const nodes = audioNodesByElement.get(audioEl) || null;
    let audioContext = nodes?.audioContext || null;
    let analyser = nodes?.analyser || null;

    const handleGesture = () => {
      if (!audioContext || audioContext.state !== "suspended") return;
      void audioContext.resume().catch(() => {});
    };

    try {
      if (!audioContext || !analyser) {
        audioContext = new AudioContextCtor();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.85;

        const source = audioContext.createMediaElementSource(audioEl);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        audioNodesByElement.set(audioEl, { audioContext, analyser, source });
      }

      window.addEventListener("pointerdown", handleGesture);
      window.addEventListener("keydown", handleGesture);
      if (audioEl && !audioEl.paused && audioContext.state === "suspended") handleGesture();
    } catch {
      return () => {};
    }

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const baseById = particleBaseRef.current;
    let smoothed = 0;
    let bassSmoothed = 0;
    let midSmoothed = 0;
    let highSmoothed = 0;
    let bassAvg = 0;
    let beatBoost = 0;
    let lastBeatAt = 0;

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    const tick = (now) => {
      if (cancelled) return;

      const container = containerRef.current;
      const canvas = container?.canvas?.element;

      const paused = audioEl.paused || audioEl.muted || audioEl.volume <= 0;

      let overall = 0;
      let bass = 0;
      let mid = 0;
      let high = 0;

      if (!paused && audioContext && audioContext.state !== "suspended") {
        analyser.getByteFrequencyData(freqData);

        let total = 0;
        let bassTotal = 0;
        let midTotal = 0;
        let highTotal = 0;
        const binCount = freqData.length;
        const bassBins = Math.min(18, binCount);
        const midStart = bassBins;
        const midEnd = Math.min(Math.floor(binCount * 0.4), binCount);
        const highStart = midEnd;

        for (let i = 0; i < binCount; i++) {
          const value = freqData[i] / 255;
          total += value;
          if (i > 0 && i < bassBins) bassTotal += value;
          if (i >= midStart && i < midEnd) midTotal += value;
          if (i >= highStart) highTotal += value;
        }

        overall = total / Math.max(1, binCount);
        bass = bassTotal / Math.max(1, bassBins - 1);
        mid = midTotal / Math.max(1, midEnd - midStart);
        high = highTotal / Math.max(1, binCount - highStart);
      }

      smoothed += (overall - smoothed) * 0.08;
      bassSmoothed += (bass - bassSmoothed) * 0.12;
      midSmoothed += (mid - midSmoothed) * 0.1;
      highSmoothed += (high - highSmoothed) * 0.15;
      bassAvg += (bassSmoothed - bassAvg) * 0.02;

      const beatGate = 140;
      const beatThreshold = Math.max(0.12, bassAvg * 1.65);
      if (!paused && bassSmoothed > beatThreshold && now - lastBeatAt > beatGate) {
        beatBoost = 1;
        lastBeatAt = now;
      }

      beatBoost *= 0.9;
      if (paused) beatBoost *= 0.85;

      const speedFactor = clamp(0.45 + smoothed * 1.6 + beatBoost * 2.4, 0.2, 4.8);
      const intensity = clamp(smoothed * 0.9 + beatBoost * 1.2, 0, 1.6);

      if (container) {
        const count = container.particles.count;

        for (let i = 0; i < count; i++) {
          const particle = container.particles.get(i);
          if (!particle || !particle.retina) continue;

          const id = particle.id;
          let base = baseById.get(id);
          if (!base) {
            const baseMoveSpeed =
              particle.retina.moveSpeed ?? container.actualOptions?.particles?.move?.speed ?? options.particles.move.speed;
            const baseMaxSpeed = particle.retina.maxSpeed ?? baseMoveSpeed;
            const baseSize = particle.size?.value ?? 1.4;
            const baseOpacity = particle.opacity?.value ?? 0.6;
            base = { moveSpeed: baseMoveSpeed, maxSpeed: baseMaxSpeed, size: baseSize, opacity: baseOpacity };
            baseById.set(id, base);
          }

          particle.retina.moveSpeed = base.moveSpeed * speedFactor;
          particle.retina.maxSpeed = base.maxSpeed * speedFactor;

          // React particle size to audio - use particle id to vary which frequency affects each star
          const freqMix = (id % 3) / 2; // 0, 0.5, or 1 - assigns particles to bass, mid, or high
          const freqReact = freqMix < 0.4 ? bassSmoothed : freqMix < 0.7 ? midSmoothed : highSmoothed;
          const sizePulse = 1 + freqReact * 1.8 + beatBoost * 2.5;
          const opacityPulse = clamp(base.opacity + freqReact * 0.5 + beatBoost * 0.4, 0.2, 1);

          if (particle.size) {
            particle.size.value = base.size * sizePulse;
          }
          if (particle.opacity) {
            particle.opacity.value = opacityPulse;
          }

          // Push particles outward only on beat hits
          if (particle.velocity && beatBoost > 0.8) {
            const angle = (id * 137.5) % 360; // golden angle for varied directions
            const rad = (angle * Math.PI) / 180;
            const pushStrength = 0.4;
            particle.velocity.x += Math.cos(rad) * pushStrength;
            particle.velocity.y += Math.sin(rad) * pushStrength;
          }
        }
      }

      if (canvas) {
        const brightness = 1 + intensity * 0.55;
        const contrast = 1 + beatBoost * 0.35;
        const glow = 8 + intensity * 14;
        const glowAlpha = 0.1 + intensity * 0.14;
        const scale = 1 + smoothed * 0.02 + beatBoost * 0.06;

        canvas.style.transformOrigin = "50% 50%";
        canvas.style.transform = `translateZ(0) scale(${scale.toFixed(4)})`;
        canvas.style.filter = `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(
          3
        )}) drop-shadow(0 0 ${glow.toFixed(1)}px rgba(116, 242, 255, ${clamp(glowAlpha, 0, 0.4).toFixed(3)}))`;
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      window.removeEventListener("pointerdown", handleGesture);
      window.removeEventListener("keydown", handleGesture);
      if (cleanupCanvasStylesRef.current) cleanupCanvasStylesRef.current();
      cleanupCanvasStylesRef.current = null;
      containerRef.current = null;
      baseById.clear();
    };
  }, [audioEl, options.particles.move.speed, ready, reducedMotion]);

  if (!ready) return null;

  return (
    <Particles
      id="lobby-stars"
      className="lobby-stars"
      particlesLoaded={particlesLoaded}
      options={options}
    />
  );
}
