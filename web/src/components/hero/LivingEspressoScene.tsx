"use client";

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

/**
 * High-performance Three.js Living Espresso physics canvas:
 *  - Scene 1: Glossy dark espresso droplet with spring-damped pointer orbital physics
 *  - Scene 2: Concentric physically damped coffee liquid ripple surface + 140 aroma/order particles
 *  - Scene 3: 12 stylized café tables reflecting live Firestore/demo availability
 *  - Scene 4: 5 live ingredient stock orbs whose radius & luminance reflect live stock health
 *  - Scene 5: Harmonic orbital overview with smooth scroll-driven camera rig
 *  - Automatic WebGL fallback (zero crash if WebGL is unavailable or disabled)
 */
export function LivingEspressoScene({ scrollProgress, overview, tables, reducedMotion }: SceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [useFallback, setUseFallback] = useState(false);

  // Mutable refs so animation loop reads fresh scroll/live data without rebuilding WebGL context
  const scrollRef = useRef(scrollProgress);
  const reducedRef = useRef(reducedMotion);
  const overviewRef = useRef(overview);
  const tablesRef = useRef(tables);

  useEffect(() => {
    scrollRef.current = scrollProgress;
  }, [scrollProgress]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    overviewRef.current = overview;
  }, [overview]);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    // Verify WebGL support upfront
    let renderer: THREE.WebGLRenderer;
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) {
        setUseFallback(true);
        return;
      }
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    } catch {
      setUseFallback(true);
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height);
    renderer.setClearColor(0x17120f, 1);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#17120F");
    scene.fog = new THREE.Fog("#17120F", 7, 19);

    const camera = new THREE.PerspectiveCamera(44, width / Math.max(1, height), 0.1, 100);
    camera.position.set(0, 1.6, 6.4);

    // Lighting
    scene.add(new THREE.AmbientLight("#fff2e2", 0.5));
    const dirLight = new THREE.DirectionalLight("#f8cfa0", 1.4);
    dirLight.position.set(5, 8, 5);
    scene.add(dirLight);
    const warmPoint = new THREE.PointLight("#C88B50", 1.2);
    warmPoint.position.set(-4, 2, 3);
    scene.add(warmPoint);
    const sagePoint = new THREE.PointLight("#8B9B7E", 0.85);
    sagePoint.position.set(3, -1, -3);
    scene.add(sagePoint);

    // 1. Sculpted Espresso Droplet (spring-damped pointer orbit)
    const dropletGroup = new THREE.Group();
    dropletGroup.position.set(0, 1.4, 0);
    const dropletMat = new THREE.MeshPhysicalMaterial({
      color: "#2c170f",
      roughness: 0.14,
      metalness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      emissive: "#c88b50",
      emissiveIntensity: 0.15,
    });
    const sphereGeo = new THREE.SphereGeometry(0.72, 32, 32);
    const coneGeo = new THREE.ConeGeometry(0.66, 1.15, 28);
    const dropBase = new THREE.Mesh(sphereGeo, dropletMat);
    const dropTip = new THREE.Mesh(coneGeo, dropletMat);
    dropTip.position.y = 0.78;
    dropletGroup.add(dropBase, dropTip);
    scene.add(dropletGroup);

    // 2. Liquid Espresso Ripple Surface
    const planeGeo = new THREE.PlaneGeometry(18, 18, 48, 48);
    const planeMat = new THREE.MeshStandardMaterial({
      color: "#241510",
      roughness: 0.28,
      metalness: 0.42,
      emissive: "#4a2815",
      emissiveIntensity: 0.28,
    });
    const liquidMesh = new THREE.Mesh(planeGeo, planeMat);
    liquidMesh.rotation.x = -Math.PI / 2;
    liquidMesh.position.y = -1.3;
    scene.add(liquidMesh);

    // 3. 140 Flowing Caramel Aroma & Order Particles
    const particleCount = 140;
    const pPositions = new Float32Array(particleCount * 3);
    const pSeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      pSeeds[i] = i / particleCount;
      pPositions[i * 3] = (Math.random() - 0.5) * 8;
      pPositions[i * 3 + 1] = (Math.random() - 0.5) * 4;
      pPositions[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPositions, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.07,
      color: "#C88B50",
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // 4. Stylized 12 Café Tables + 5 Live Ingredient Flow Orbs
    const cafeGroup = new THREE.Group();
    cafeGroup.position.set(0, -0.85, -1.8);
    const tableGeo = new THREE.CylinderGeometry(0.36, 0.32, 0.1, 18);
    const legGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.35, 10);
    const legMat = new THREE.MeshStandardMaterial({ color: "#3b261c", roughness: 0.6 });
    const tableMats: THREE.MeshStandardMaterial[] = [];

    for (let idx = 0; idx < 12; idx++) {
      const col = idx % 4;
      const row = Math.floor(idx / 4);
      const tGroup = new THREE.Group();
      tGroup.position.set((col - 1.5) * 1.35, 0, (row - 1) * 1.35);
      const topMat = new THREE.MeshStandardMaterial({ color: "#8B9B7E", emissive: "#8B9B7E", emissiveIntensity: 0.35, roughness: 0.4 });
      tableMats.push(topMat);
      const topMesh = new THREE.Mesh(tableGeo, topMat);
      topMesh.position.y = 0.14;
      const legMesh = new THREE.Mesh(legGeo, legMat);
      legMesh.position.y = -0.05;
      tGroup.add(topMesh, legMesh);
      cafeGroup.add(tGroup);
    }

    const orbGeo = new THREE.SphereGeometry(0.3, 20, 20);
    const orbMeshes: THREE.Mesh[] = [];
    const orbMats: THREE.MeshStandardMaterial[] = [];
    for (let idx = 0; idx < 5; idx++) {
      const angle = (idx / 5) * Math.PI * 2;
      const mat = new THREE.MeshStandardMaterial({ color: "#4D9276", emissive: "#4D9276", emissiveIntensity: 0.45, roughness: 0.25 });
      const orb = new THREE.Mesh(orbGeo, mat);
      orb.position.set(Math.cos(angle) * 3.2, 0.85 + Math.sin(idx) * 0.25, Math.sin(angle) * 2.4 - 1.5);
      orbMeshes.push(orb);
      orbMats.push(mat);
      cafeGroup.add(orb);
    }
    scene.add(cafeGroup);

    // Pointer tracking (normalized -1..1)
    const pointer = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
      pointer.y = -(e.clientY / Math.max(1, window.innerHeight)) * 2 + 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Spring-damped physics loop
    const vel = { x: 0, y: 0 };
    const camTarget = new THREE.Vector3(0, 1.8, 6.2);
    const clock = new THREE.Clock();
    let rafId = 0;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      if (document.hidden) return;

      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = reducedRef.current ? 1.0 : clock.getElapsedTime();
      const sp = scrollRef.current;

      // Update camera smoothly along 5-chapter journey
      const camZ = THREE.MathUtils.lerp(6.4, 3.8, Math.sin(sp * Math.PI)) + sp * 1.4;
      const camY = THREE.MathUtils.lerp(1.4, 3.6, sp);
      const camX = (reducedRef.current ? 0 : pointer.x * 0.55) + Math.sin(sp * Math.PI * 1.6) * 1.1;
      camTarget.set(camX, camY, camZ);
      camera.position.lerp(camTarget, 1 - Math.exp(-4.5 * dt));
      camera.lookAt(0, -0.35, -sp * 1.4);

      // Update droplet spring physics
      const targetX = reducedRef.current ? 0 : pointer.x * 0.75;
      const targetY = THREE.MathUtils.lerp(1.4, -1.45, Math.min(1, sp * 3.2)) + Math.sin(elapsed * 1.4) * 0.12;
      vel.x += ((targetX - dropletGroup.position.x) * 28 - vel.x * 6.5) * dt;
      vel.y += ((targetY - dropletGroup.position.y) * 28 - vel.y * 6.5) * dt;
      dropletGroup.position.x += vel.x * dt;
      dropletGroup.position.y += vel.y * dt;
      dropletGroup.rotation.y = elapsed * 0.35 + pointer.x * 0.4;
      dropletGroup.rotation.z = pointer.x * -0.15;
      dropletGroup.scale.setScalar(Math.max(0.01, 1.0 - Math.max(0, sp - 0.32) * 4.0));

      // Update liquid concentric ripples
      const posAttr = planeGeo.attributes.position as THREE.BufferAttribute;
      const impact = Math.max(0.25, 1.0 - Math.abs(sp - 0.25) * 2.2);
      const px = pointer.x * 2.5;
      const py = pointer.y * 2.5;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const dc = Math.sqrt(x * x + y * y);
        const dp = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        const wave = Math.sin(dc * 2.3 - elapsed * 2.8) * Math.exp(-dc * 0.24) * 0.34 * impact;
        const pWave = Math.cos(dp * 3.1 - elapsed * 3.2) * Math.exp(-dp * 0.55) * 0.14;
        posAttr.setZ(i, wave + pWave);
      }
      posAttr.needsUpdate = true;

      // Update flowing aroma/order particles (faster during Rush Hour)
      const isRush = overviewRef.current?.scenario === "rush";
      pMat.size = isRush ? 0.095 : 0.068;
      pMat.color.set(isRush ? "#E0AC76" : "#C88B50");
      const speed = isRush ? 0.24 : 0.11;
      const pt = reducedRef.current ? 0.5 : elapsed * speed;
      const pAttr = pGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        const u = (pSeeds[i] + pt) % 1;
        const angle = u * Math.PI * 4 + sp * Math.PI * 2;
        const radius = 1.6 + Math.sin(u * Math.PI) * (2.6 + sp * 1.4);
        pAttr.setXYZ(
          i,
          Math.cos(angle) * radius + pointer.x * 0.45,
          -1.0 + Math.sin(u * Math.PI * 2) * 1.5 + (sp > 0.5 ? 0.3 : 0),
          Math.sin(angle) * radius - sp * 2.2
        );
      }
      pAttr.needsUpdate = true;

      // Update living café tables & live ingredient stock nodes
      const vis = THREE.MathUtils.clamp((sp - 0.3) * 3.5, 0, 1);
      cafeGroup.scale.setScalar(0.001 + vis * 0.999);
      cafeGroup.rotation.y = Math.sin(elapsed * 0.2) * 0.08 + (sp - 0.5) * 0.6;

      const liveTables = tablesRef.current;
      for (let i = 0; i < 12; i++) {
        const tbl = liveTables[i];
        const c = !tbl || tbl.status === "free" ? "#8B9B7E" : tbl.status === "reserved" ? "#C88B50" : "#5D453B";
        tableMats[i].color.set(c);
        tableMats[i].emissive.set(c);
        tableMats[i].emissiveIntensity = !tbl || tbl.status === "free" ? 0.38 : 0.14;
      }

      const nodes = overviewRef.current?.ingredientFlowNodes || [];
      for (let i = 0; i < 5; i++) {
        const n = nodes[i];
        if (!n) continue;
        const c = n.status === "out" ? "#D86F51" : n.status === "low" ? "#C88B50" : "#4D9276";
        orbMats[i].color.set(c);
        orbMats[i].emissive.set(c);
        orbMeshes[i].scale.setScalar(0.6 + Math.max(0.15, n.healthRatio) * 0.9);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", onResize);
      sphereGeo.dispose();
      coneGeo.dispose();
      planeGeo.dispose();
      pGeo.dispose();
      tableGeo.dispose();
      legGeo.dispose();
      orbGeo.dispose();
      dropletMat.dispose();
      planeMat.dispose();
      pMat.dispose();
      legMat.dispose();
      tableMats.forEach((m) => m.dispose());
      orbMats.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, []);

  if (useFallback) {
    return (
      <EspressoFallbackVisual
        scrollProgress={scrollProgress}
        overview={overview}
        tables={tables}
        reason={reducedMotion ? "reduced-motion" : "webgl-unavailable"}
      />
    );
  }

  return <div ref={containerRef} className="h-full w-full" data-testid="hero-webgl-container" />;
}
