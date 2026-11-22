"use client";

/**
 * AURA living espresso hero — plain Three.js (no React reconciler).
 *
 * Why not @react-three/fiber: R3F v8 targets React 18 internals, while the Next.js 15
 * App Router renders with its own bundled React 19 build. That mismatch crashed the
 * whole homepage ("reading 'ReactCurrentBatchConfig'"). A vanilla renderer driven from
 * one useEffect has no React-version coupling at all.
 *
 * Performance: the ripple is computed in the vertex shader (GPU) with analytic normals,
 * particles are GPU-animated soft sprites, the loop stops while the tab is hidden,
 * DPR is capped at 1.5, and every GPU resource is disposed on unmount.
 */

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { CafeOverview, TableItem } from "@/lib/types";
import { EspressoFallbackVisual } from "./EspressoFallbackVisual";

interface SceneProps {
  scrollProgress: number;
  overview: CafeOverview | null;
  tables: TableItem[];
  reducedMotion: boolean;
}

const COLORS = {
  espresso: new THREE.Color("#17120F"),
  caramel: new THREE.Color("#C88B50"),
  caramelLight: new THREE.Color("#E0AC76"),
  sage: new THREE.Color("#8B9B7E"),
  clay: new THREE.Color("#5D453B"),
  coral: new THREE.Color("#D86F51"),
  success: new THREE.Color("#4D9276"),
};

const SURFACE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uImpact;
  uniform vec2 uPointer;
  varying float vHeight;
  varying vec3 vWorld;
  varying vec3 vNormal;

  float heightAt(vec2 p) {
    float d = length(p);
    float main = sin(d * 2.4 - uTime * 2.6) * exp(-d * 0.26) * 0.32 * uImpact;
    float pd = length(p - uPointer);
    float touch = cos(pd * 3.4 - uTime * 3.4) * exp(-pd * 0.7) * 0.12;
    float swell = sin(p.x * 0.6 + uTime * 0.5) * cos(p.y * 0.5 - uTime * 0.4) * 0.05;
    return main + touch + swell;
  }

  void main() {
    vec2 p = position.xy;
    float h = heightAt(p);
    float e = 0.06;
    float hx = heightAt(p + vec2(e, 0.0)) - h;
    float hy = heightAt(p + vec2(0.0, e)) - h;
    vNormal = normalize(mat3(modelMatrix) * normalize(vec3(-hx / e, -hy / e, 1.0)));
    vHeight = h;
    vec4 world = modelMatrix * vec4(p, h, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURFACE_FRAG = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uCrema;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  varying float vHeight;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 lightDir = normalize(vec3(0.4, 1.0, 0.35));
    float diff = max(dot(n, lightDir), 0.0);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    vec3 halfV = normalize(lightDir + viewDir);
    float spec = pow(max(dot(n, halfV), 0.0), 48.0);

    float crest = smoothstep(-0.05, 0.28, vHeight);
    vec3 base = mix(uDeep, uCrema * 0.55, crest * 0.6);
    vec3 col = base * (0.35 + diff * 0.65) + uCrema * fres * 0.55 + vec3(1.0, 0.86, 0.66) * spec * 0.55;

    float dist = length(cameraPosition - vWorld);
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    gl_FragColor = vec4(mix(col, uFog, fogF), 1.0);
    #include <colorspace_fragment>
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uScroll;
  uniform vec2 uPointer;
  uniform float uSize;
  varying float vAlpha;

  void main() {
    float u = fract(aSeed + uTime * uSpeed);
    float angle = u * 12.566 + uScroll * 6.283 + aSeed * 3.0;
    float radius = 1.5 + sin(u * 3.1416) * (2.5 + uScroll * 1.6);
    vec3 p = vec3(
      cos(angle) * radius + uPointer.x * 0.5,
      -0.9 + sin(u * 6.283) * 1.4 + aSeed * 0.6,
      sin(angle) * radius - uScroll * 2.0
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aSeed * 0.8) / -mv.z;
    vAlpha = sin(u * 3.1416);
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha * 0.9;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

/** Teardrop profile for a LatheGeometry (bottom -> tip). */
function dropletProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -0.7 + t * 1.9;
    // Rounded (hemispherical) bottom, then a smooth taper to the tip.
    const u = (0.38 - t) / 0.38;
    const r = t < 0.38 ? 0.7 * Math.sqrt(Math.max(0, 1 - u * u)) : 0.7 * Math.pow(1 - (t - 0.38) / 0.62, 1.6);
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
  }
  return pts;
}

function tableColor(status: string): THREE.Color {
  if (status === "free") return COLORS.sage;
  if (status === "reserved") return COLORS.caramel;
  return COLORS.clay;
}

function nodeColor(status: string): THREE.Color {
  if (status === "out") return COLORS.coral;
  if (status === "low") return COLORS.caramel;
  return COLORS.success;
}

function detectWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function LivingEspressoScene({ scrollProgress, overview, tables, reducedMotion }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Live inputs read by the render loop without rebuilding the WebGL scene.
  const scrollRef = useRef(scrollProgress);
  const overviewRef = useRef(overview);
  const tablesRef = useRef(tables);
  const reducedRef = useRef(reducedMotion);
  const dataVersion = useRef(0);

  useEffect(() => {
    scrollRef.current = scrollProgress;
  }, [scrollProgress]);
  useEffect(() => {
    overviewRef.current = overview;
    tablesRef.current = tables;
    dataVersion.current += 1;
  }, [overview, tables]);
  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!detectWebGL()) {
      setFailed(true);
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      return;
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.setClearColor(COLORS.espresso, 1);
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(COLORS.espresso, 7, 19);
    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 60);
    camera.position.set(0, 1.6, 6.4);

    // Point-light intensities are in candela with physical decay in three r155+.
    scene.add(new THREE.AmbientLight(0xfff2e2, 0.5));
    const key = new THREE.DirectionalLight(0xf8cfa0, 1.6);
    key.position.set(5, 8, 5);
    scene.add(key);
    const warm = new THREE.PointLight(0xc88b50, 14, 20);
    warm.position.set(-4, 2, 3);
    scene.add(warm);
    const cool = new THREE.PointLight(0x8b9b7e, 8, 18);
    cool.position.set(3, -1, -3);
    scene.add(cool);

    const disposables: Array<{ dispose: () => void }> = [];

    // --- Espresso surface (GPU ripple, analytic normals) ---
    const surfaceGeom = new THREE.PlaneGeometry(22, 22, 160, 160);
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uImpact: { value: 0.4 },
        uPointer: { value: new THREE.Vector2() },
        uDeep: { value: new THREE.Color("#1d110b") },
        uCrema: { value: COLORS.caramel.clone() },
        uFog: { value: COLORS.espresso.clone() },
        uFogNear: { value: 7 },
        uFogFar: { value: 19 },
      },
    });
    const surface = new THREE.Mesh(surfaceGeom, surfaceMat);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = -1.3;
    scene.add(surface);
    disposables.push(surfaceGeom, surfaceMat);

    // --- Droplet ---
    const dropGeom = new THREE.LatheGeometry(dropletProfile(), 64);
    const dropMat = new THREE.MeshPhysicalMaterial({
      color: 0x2c170f,
      roughness: 0.12,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: COLORS.caramel,
      emissiveIntensity: 0.12,
      sheen: 0.6,
      sheenColor: COLORS.caramelLight,
    });
    const droplet = new THREE.Mesh(dropGeom, dropMat);
    // Start low enough that the tip stays inside the canvas (it sits below the 64px navbar).
    droplet.position.set(0, 0.55, 0);
    scene.add(droplet);
    disposables.push(dropGeom, dropMat);
    const dropVel = new THREE.Vector2();

    // --- Aroma / order particles (GPU-animated soft sprites) ---
    const PCOUNT = 260;
    const pGeom = new THREE.BufferGeometry();
    const seeds = new Float32Array(PCOUNT);
    for (let i = 0; i < PCOUNT; i++) seeds[i] = i / PCOUNT;
    pGeom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PCOUNT * 3), 3));
    pGeom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const pMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: 0.1 },
        uScroll: { value: 0 },
        uPointer: { value: new THREE.Vector2() },
        uSize: { value: 42 * pixelRatio },
        uColor: { value: COLORS.caramel.clone() },
      },
    });
    const particles = new THREE.Points(pGeom, pMat);
    particles.frustumCulled = false;
    scene.add(particles);
    disposables.push(pGeom, pMat);

    // --- Living café: 12 tables (instanced) + ingredient orbs ---
    const cafe = new THREE.Group();
    cafe.position.set(0, -0.85, -1.8);
    scene.add(cafe);
    const topGeom = new THREE.CylinderGeometry(0.36, 0.32, 0.1, 28);
    const topMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 });
    const legGeom = new THREE.CylinderGeometry(0.07, 0.09, 0.35, 12);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3b261c, roughness: 0.6 });
    const MAX_TABLES = 12;
    const tops = new THREE.InstancedMesh(topGeom, topMat, MAX_TABLES);
    const legs = new THREE.InstancedMesh(legGeom, legMat, MAX_TABLES);
    tops.count = 0;
    legs.count = 0;
    cafe.add(tops, legs);
    disposables.push(topGeom, topMat, legGeom, legMat);

    const orbGeom = new THREE.SphereGeometry(1, 32, 32);
    disposables.push(orbGeom);
    const orbs: THREE.Mesh[] = [];

    const m4 = new THREE.Matrix4();
    let seenVersion = -1;
    const syncData = () => {
      const tbls = tablesRef.current;
      const n = Math.min(tbls.length, MAX_TABLES);
      for (let i = 0; i < n; i++) {
        const x = ((i % 4) - 1.5) * 1.35;
        const z = (Math.floor(i / 4) - 1) * 1.35;
        m4.makeTranslation(x, 0.14, z);
        tops.setMatrixAt(i, m4);
        tops.setColorAt(i, tableColor(tbls[i].status));
        m4.makeTranslation(x, -0.05, z);
        legs.setMatrixAt(i, m4);
      }
      tops.count = n;
      legs.count = n;
      tops.instanceMatrix.needsUpdate = true;
      legs.instanceMatrix.needsUpdate = true;
      if (tops.instanceColor) tops.instanceColor.needsUpdate = true;

      orbs.forEach((o) => {
        cafe.remove(o);
        (o.material as THREE.Material).dispose();
      });
      orbs.length = 0;
      const nodes = overviewRef.current?.ingredientFlowNodes || [];
      nodes.forEach((node, idx) => {
        const angle = (idx / Math.max(1, nodes.length)) * Math.PI * 2;
        const color = nodeColor(node.status);
        const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.25 });
        const orb = new THREE.Mesh(orbGeom, mat);
        orb.scale.setScalar(0.16 + Math.max(0.12, node.healthRatio) * 0.3);
        orb.position.set(Math.cos(angle) * 3.2, 0.85 + Math.sin(idx) * 0.25, Math.sin(angle) * 2.4 - 1.5);
        cafe.add(orb);
        orbs.push(orb);
      });

      const rush = overviewRef.current?.scenario === "rush";
      pMat.uniforms.uSpeed.value = rush ? 0.22 : 0.1;
      (pMat.uniforms.uColor.value as THREE.Color).copy(rush ? COLORS.caramelLight : COLORS.caramel);
    };

    // --- Sizing ---
    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // --- Pointer (window-level so the canvas can stay pointer-events:none) ---
    const pointer = new THREE.Vector2();
    const pointerTarget = new THREE.Vector2();
    const zero = new THREE.Vector2();
    const onPointer = (e: PointerEvent) => {
      pointerTarget.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    // --- Loop ---
    const clock = new THREE.Clock();
    const camTarget = new THREE.Vector3();
    let raf = 0;
    let running = true;

    const frame = () => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      const reduced = reducedRef.current;
      const t = reduced ? 1.2 : clock.elapsedTime;
      const s = scrollRef.current;

      if (seenVersion !== dataVersion.current) {
        seenVersion = dataVersion.current;
        syncData();
      }

      pointer.lerp(reduced ? zero : pointerTarget, 1 - Math.exp(-6 * dt));

      // Ripple strength peaks as the drop lands (~25% scroll).
      surfaceMat.uniforms.uTime.value = t;
      surfaceMat.uniforms.uImpact.value = Math.max(0.3, 1 - Math.abs(s - 0.25) * 2.2);
      (surfaceMat.uniforms.uPointer.value as THREE.Vector2).set(pointer.x * 3, pointer.y * 3);

      // Droplet: spring-damped follow, falls with scroll, then dissolves.
      const tx = reduced ? 0 : pointer.x * 0.75;
      const ty = THREE.MathUtils.lerp(0.55, -1.45, Math.min(1, s * 3.2)) + Math.sin(t * 1.4) * 0.1;
      dropVel.x += ((tx - droplet.position.x) * 28 - dropVel.x * 6.5) * dt;
      dropVel.y += ((ty - droplet.position.y) * 28 - dropVel.y * 6.5) * dt;
      droplet.position.x += dropVel.x * dt;
      droplet.position.y += dropVel.y * dt;
      droplet.rotation.y = t * 0.35 + pointer.x * 0.4;
      droplet.rotation.z = pointer.x * -0.15 - dropVel.x * 0.04;
      droplet.scale.setScalar(Math.max(0.001, 1 - Math.max(0, s - 0.32) * 4));

      pMat.uniforms.uTime.value = reduced ? 0.5 : clock.elapsedTime;
      pMat.uniforms.uScroll.value = s;
      (pMat.uniforms.uPointer.value as THREE.Vector2).copy(pointer);

      const vis = THREE.MathUtils.clamp((s - 0.3) * 3.5, 0, 1);
      cafe.scale.setScalar(0.001 + vis * 0.999);
      cafe.rotation.y = (reduced ? 0 : Math.sin(t * 0.2) * 0.08) + (s - 0.5) * 0.6;
      orbs.forEach((o, i) => {
        o.position.y = 0.85 + Math.sin(i) * 0.25 + (reduced ? 0 : Math.sin(t * 1.2 + i) * 0.06);
      });

      const z = THREE.MathUtils.lerp(6.4, 3.8, Math.sin(s * Math.PI)) + s * 1.4;
      const y = THREE.MathUtils.lerp(1.4, 3.6, s);
      const x = (reduced ? 0 : pointer.x * 0.55) + Math.sin(s * Math.PI * 1.6) * 1.1;
      camTarget.set(x, y, z);
      camera.position.lerp(camTarget, 1 - Math.exp(-4.5 * dt));
      camera.lookAt(0, -0.35, -s * 1.4);

      renderer.render(scene, camera);
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        clock.getDelta();
        frame();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", onLost);

    try {
      frame();
    } catch {
      setFailed(true);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener("webglcontextlost", onLost);
      orbs.forEach((o) => (o.material as THREE.Material).dispose());
      tops.dispose();
      legs.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (failed) {
    return (
      <EspressoFallbackVisual
        scrollProgress={scrollProgress}
        overview={overview}
        tables={tables}
        reason={reducedMotion ? "reduced-motion" : "webgl-unavailable"}
      />
    );
  }

  return <div ref={hostRef} className="h-full w-full" data-testid="hero-webgl-container" />;
}
