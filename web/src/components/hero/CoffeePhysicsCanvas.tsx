"use client";

import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { CafeOverview, TableItem } from "@/lib/types";
import { CafeEnvironment3D } from "./CafeEnvironment3D";
import { CoffeeBeansPhysics } from "./CoffeeBeansPhysics";
import { CoffeeSteam } from "./CoffeeSteam";
import { EspressoFallbackVisual } from "./EspressoFallbackVisual";
import { EspressoLiquid } from "./EspressoLiquid";
import { createCremaNoiseTexture, createStudioEnvTexture } from "./coffeeTextures";

export interface CoffeePhysicsCanvasProps {
  overview: CafeOverview | null;
  tables: TableItem[];
  reducedMotion: boolean;
  pourNonce?: number;
  dropNonce?: number;
}

declare global {
  interface Window {
    __AURA_3D_STATS__?: {
      drawCalls: number;
      triangles: number;
      fps: number;
      beansCount: number;
      rapierReady: boolean;
    };
  }
}

class CanvasErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function probeWebGL(): { supported: boolean; isSoftware: boolean } {
  if (typeof document === "undefined") return { supported: false, isSoftware: false };
  try {
    const c = document.createElement("canvas");
    const ctx = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!ctx) return { supported: false, isSoftware: false };
    const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
    const rendererStr = dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
    const isSoftware = /swiftshader|llvmpipe|software|basic render driver|subzero/i.test(rendererStr);
    return { supported: true, isSoftware };
  } catch {
    return { supported: false, isSoftware: false };
  }
}

interface Keyframe {
  s: number;
  pos: [number, number, number];
  target: [number, number, number];
}

const CAMERA_KEYFRAMES: Keyframe[] = [
  // Scene 1: Elevated macro close-up revealing espresso crema, pour stream, steam & scattered beans
  { s: 0.0, pos: [0.42, 1.56, 2.04], target: [-0.20, 0.24, 0.08] },
  // Scene 2: Pull back into warm sunlit specialty café room
  { s: 0.22, pos: [-0.72, 1.66, 2.85], target: [0.16, 0.02, -3.1] },
  // Scene 3: Glide right to Bean-to-Cup craft still life
  { s: 0.44, pos: [1.72, 1.38, 1.78], target: [2.02, 0.22, -0.22] },
  // Scene 4: Calm elevated backdrop behind 2D Intelligent Inventory
  { s: 0.72, pos: [0.35, 2.15, 2.65], target: [0.45, 0.08, -0.35] },
  // Scene 5: Serene wide café closing frame
  { s: 1.0, pos: [-0.28, 1.52, 3.28], target: [0.22, 0.25, -1.5] },
];

function sampleCameraTrack(s: number, isNarrow: boolean) {
  const clamped = THREE.MathUtils.clamp(s, 0, 1);
  let i = 0;
  while (i < CAMERA_KEYFRAMES.length - 2 && clamped > CAMERA_KEYFRAMES[i + 1].s) {
    i++;
  }
  const a = CAMERA_KEYFRAMES[i];
  const b = CAMERA_KEYFRAMES[i + 1];
  const localT = THREE.MathUtils.smoothstep((clamped - a.s) / Math.max(0.0001, b.s - a.s), 0, 1);

  const pos = new THREE.Vector3(
    THREE.MathUtils.lerp(a.pos[0], b.pos[0], localT),
    THREE.MathUtils.lerp(a.pos[1], b.pos[1], localT),
    THREE.MathUtils.lerp(a.pos[2], b.pos[2], localT)
  );
  const target = new THREE.Vector3(
    THREE.MathUtils.lerp(a.target[0], b.target[0], localT),
    THREE.MathUtils.lerp(a.target[1], b.target[1], localT),
    THREE.MathUtils.lerp(a.target[2], b.target[2], localT)
  );

  if (isNarrow && clamped < 0.20) {
    const mobileWeight = 1 - clamped / 0.20;
    target.x = THREE.MathUtils.lerp(target.x, 0.0, mobileWeight);
    target.y = THREE.MathUtils.lerp(target.y, 0.38, mobileWeight);
    pos.x = THREE.MathUtils.lerp(pos.x, 0.24, mobileWeight);
    pos.z += 0.56 * mobileWeight;
  }

  return { pos, target };
}

function SceneCameraRig({
  scrollRef,
  pointerRef,
  reducedMotion,
  isTouch,
}: {
  scrollRef: React.MutableRefObject<number>;
  pointerRef: React.MutableRefObject<THREE.Vector2>;
  reducedMotion: boolean;
  isTouch: boolean;
}) {
  const { camera, size } = useThree();
  const smoothPos = useRef(new THREE.Vector3(0.42, 1.56, 2.04));
  const smoothTarget = useRef(new THREE.Vector3(-0.20, 0.24, 0.08));

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const isNarrow = size.width / Math.max(1, size.height) < 0.9;
    const { pos, target } = sampleCameraTrack(scrollRef.current, isNarrow);

    if (!reducedMotion && !isTouch) {
      pos.x += pointerRef.current.x * 0.085;
      pos.y += pointerRef.current.y * 0.055;
    }

    const alpha = reducedMotion ? 1 : 1 - Math.exp(-5.0 * dt);
    smoothPos.current.lerp(pos, alpha);
    smoothTarget.current.lerp(target, alpha);
    camera.position.copy(smoothPos.current);
    camera.lookAt(smoothTarget.current);
  });

  return null;
}

function PerfTelemetry({ beansCount, rapierReady }: { beansCount: number; rapierReady: boolean }) {
  const { gl } = useThree();
  const framesRef = useRef(0);
  const accumRef = useRef(0);
  const reportedFirstRef = useRef(false);

  useFrame((_, delta) => {
    framesRef.current += 1;
    accumRef.current += delta;
    if ((rapierReady && !reportedFirstRef.current) || framesRef.current >= 8) {
      if (rapierReady) reportedFirstRef.current = true;
      if (typeof window !== "undefined") {
        const fps = Math.round(framesRef.current / Math.max(0.001, accumRef.current));
        window.__AURA_3D_STATS__ = {
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          fps,
          beansCount,
          rapierReady,
        };
      }
      framesRef.current = 0;
      accumRef.current = 0;
    }
  });

  return null;
}

const CoffeeSceneContent = React.memo(function CoffeeSceneContent({
  scrollRef,
  pointerRef,
  clickPulseRef,
  overview,
  tables,
  reducedMotion,
  isMobile,
  isTouch,
  isSoftware,
  pourNonce,
  dropNonce,
}: {
  scrollRef: React.MutableRefObject<number>;
  pointerRef: React.MutableRefObject<THREE.Vector2>;
  clickPulseRef: React.MutableRefObject<{ pending: boolean; ndc: THREE.Vector2 }>;
  overview: CafeOverview | null;
  tables: TableItem[];
  reducedMotion: boolean;
  isMobile: boolean;
  isTouch: boolean;
  isSoftware: boolean;
  pourNonce: number;
  dropNonce: number;
}) {
  const { scene, gl } = useThree();
  const cremaNoiseTex = useMemo(() => createCremaNoiseTexture(), []);
  const fallbackEnvTex = useMemo(() => createStudioEnvTexture(), []);
  const [beansCount, setBeansCount] = useState(isMobile ? 16 : 32);
  const [rapierReady, setRapierReady] = useState(false);

  const handleBeansReady = useCallback((count: number) => {
    setBeansCount(count);
    setRapierReady(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    let pmremTarget: THREE.WebGLRenderTarget | null = null;

    if (isSoftware) {
      // Software CPU rasterizers skip expensive per-pixel PMREM IBL & use crisp 3-point direct lighting
      scene.environment = null;
      return () => {
        fallbackEnvTex.dispose();
        cremaNoiseTex.dispose();
      };
    }

    // Immediate studio reflection fallback on Frame 1 while local CC0 HDRI decodes (<5ms)
    scene.environment = fallbackEnvTex;
    scene.environmentIntensity = 1.15;

    const loader = new RGBELoader();
    loader.load(
      "/textures/coffee/brown-photostudio-02-1k.hdr",
      (hdrTex) => {
        if (disposed) {
          hdrTex.dispose();
          return;
        }
        const pmrem = new THREE.PMREMGenerator(gl);
        pmrem.compileEquirectangularShader();
        pmremTarget = pmrem.fromEquirectangular(hdrTex);
        hdrTex.dispose();
        pmrem.dispose();

        scene.environment = pmremTarget.texture;
        scene.environmentIntensity = 1.32;
      },
      undefined,
      () => {
        // Keep synchronous studio fallback texture on any load error
      }
    );

    return () => {
      disposed = true;
      if (scene.environment === fallbackEnvTex || (pmremTarget && scene.environment === pmremTarget.texture)) {
        scene.environment = null;
      }
      fallbackEnvTex.dispose();
      pmremTarget?.dispose();
      cremaNoiseTex.dispose();
    };
  }, [scene, gl, fallbackEnvTex, cremaNoiseTex, isSoftware]);

  const shadowMapSize: [number, number] = isMobile ? [512, 512] : [1024, 1024];

  return (
    <>
      <color attach="background" args={["#1A100B"]} />
      <fog attach="fog" args={["#1A100B", 5.8, 15.0]} />

      {/* Warm product-photography lighting rig revealing porcelain glaze, crema & roasted bean relief */}
      <hemisphereLight args={["#FFF3E2", "#3A261B", isSoftware ? 0.96 : 0.72]} />
      <directionalLight
        position={[-3.6, 4.4, 3.4]}
        intensity={isSoftware ? 3.4 : 3.2}
        color="#FFE8CC"
        castShadow={!isSoftware}
        shadow-mapSize={shadowMapSize}
        shadow-camera-near={0.5}
        shadow-camera-far={16}
        shadow-camera-left={-2.8}
        shadow-camera-right={2.8}
        shadow-camera-top={2.8}
        shadow-camera-bottom={-2.8}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={3.5}
      />
      <directionalLight position={[2.6, 2.2, 3.2]} intensity={isSoftware ? 1.15 : 0.95} color="#F2DEC6" />
      <spotLight position={[3.0, 2.7, -1.8]} intensity={2.5} color="#E8B882" angle={0.68} penumbra={0.95} />

      <SceneCameraRig
        scrollRef={scrollRef}
        pointerRef={pointerRef}
        reducedMotion={reducedMotion}
        isTouch={isTouch}
      />

      <Suspense fallback={null}>
        <CafeEnvironment3D overview={overview} tables={tables} isSoftware={isSoftware} />
        {!isSoftware && (
          <ContactShadows
            position={[0.4, 0.002, 0]}
            opacity={0.46}
            scale={7.5}
            blur={1.9}
            far={2.2}
            resolution={256}
            frames={1}
            color="#120805"
          />
        )}
      </Suspense>

      <EspressoLiquid
        scrollRef={scrollRef}
        cremaNoiseTex={cremaNoiseTex}
        pourNonce={pourNonce}
        reducedMotion={reducedMotion}
      />

      <CoffeeSteam pointerRef={pointerRef} reducedMotion={reducedMotion} />

      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} paused={reducedMotion}>
          <CoffeeBeansPhysics
            isMobile={isMobile}
            isSoftware={isSoftware}
            reducedMotion={reducedMotion}
            scrollRef={scrollRef}
            pointerRef={pointerRef}
            clickPulseRef={clickPulseRef}
            dropNonce={dropNonce}
            onReady={handleBeansReady}
          />
        </Physics>
      </Suspense>

      <PerfTelemetry beansCount={beansCount} rapierReady={rapierReady} />
    </>
  );
});

export function CoffeePhysicsCanvas({
  overview,
  tables,
  reducedMotion,
  pourNonce = 0,
  dropNonce = 0,
}: CoffeePhysicsCanvasProps) {
  const [webglInfo, setWebglInfo] = useState<{ supported: boolean; isSoftware: boolean } | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  const scrollRef = useRef(0);
  const pointerRef = useRef(new THREE.Vector2(0, 0));
  const clickPulseRef = useRef({ pending: false, ndc: new THREE.Vector2(0, 0) });

  useEffect(() => {
    setWebglInfo(probeWebGL());
    const updateViewport = () => {
      setIsMobile(window.innerWidth < 768);
      setIsTouch(window.matchMedia("(pointer: coarse)").matches);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport, { passive: true });

    const syncScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const s = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      scrollRef.current = s;
      // Pause WebGL render loop automatically when Scene 4 solid 2D cream covers the viewport
      const occludedByInventory = s > 0.61 && s < 0.85;
      setIsPaused(document.hidden || occludedByInventory);
    };
    syncScroll();
    window.addEventListener("scroll", syncScroll, { passive: true });

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("a, button, input, select, textarea, [role='button']")) {
        return;
      }
      clickPulseRef.current.ndc.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      clickPulseRef.current.pending = true;
    };

    const onVisibility = () => {
      syncScroll();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("scroll", syncScroll);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const cameraConfig = useMemo(
    () => ({ fov: 35, near: 0.1, far: 30, position: [0.42, 1.56, 2.04] as [number, number, number] }),
    []
  );
  const glConfig = useMemo(
    () => ({
      antialias: !webglInfo?.isSoftware,
      powerPreference: "high-performance" as const,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.24,
    }),
    [webglInfo?.isSoftware]
  );
  const dprValue = useMemo<[number, number]>(() => {
    if (webglInfo?.isSoftware) return [0.75, 0.85];
    return isMobile ? [1, 1.25] : [1, 1.5];
  }, [webglInfo?.isSoftware, isMobile]);

  if (webglInfo?.supported === false || contextLost || reducedMotion) {
    return (
      <EspressoFallbackVisual
        overview={overview}
        tables={tables}
        reason={reducedMotion ? "reduced-motion" : "webgl-unavailable"}
      />
    );
  }

  if (webglInfo === null) {
    return <EspressoFallbackVisual overview={overview} tables={tables} />;
  }

  const fallbackNode = (
    <EspressoFallbackVisual overview={overview} tables={tables} reason="webgl-fallback" />
  );

  return (
    <CanvasErrorBoundary fallback={fallbackNode}>
      <div className="h-full w-full" data-testid="hero-webgl-container">
        <Canvas
          shadows={!webglInfo.isSoftware}
          dpr={dprValue}
          frameloop={isPaused ? "never" : "always"}
          camera={cameraConfig}
          gl={glConfig}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              setContextLost(true);
            });
          }}
        >
          <Suspense fallback={null}>
            <CoffeeSceneContent
              scrollRef={scrollRef}
              pointerRef={pointerRef}
              clickPulseRef={clickPulseRef}
              overview={overview}
              tables={tables}
              reducedMotion={reducedMotion}
              isMobile={isMobile}
              isTouch={isTouch}
              isSoftware={webglInfo.isSoftware}
              pourNonce={pourNonce}
              dropNonce={dropNonce}
            />
          </Suspense>
        </Canvas>
      </div>
    </CanvasErrorBoundary>
  );
}
