"use client";

import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CafeOverview, TableItem } from "@/lib/types";
import { EspressoFallbackVisual } from "./EspressoFallbackVisual";

interface SceneProps {
  scrollProgress: number;
  overview: CafeOverview | null;
  tables: TableItem[];
  reducedMotion: boolean;
}

class WebGLErrorBoundary extends Component<
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
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * Custom animated ripple surface (Scene 1 & 2) using concentric physically damped sine waves.
 */
function EspressoLiquidSurface({
  scrollProgress,
  reducedMotion,
}: {
  scrollProgress: number;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => new THREE.PlaneGeometry(18, 18, 52, 52), []);

  useFrame(({ clock, pointer }) => {
    if (!meshRef.current) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const t = reducedMotion ? 1.2 : clock.getElapsedTime();
    // Ripple amplitude peaks around Scene 2 (20–40% scroll)
    const impactFactor = Math.max(0.25, 1.0 - Math.abs(scrollProgress - 0.25) * 2.2);
    const px = pointer.x * 2.5;
    const py = pointer.y * 2.5;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const distCenter = Math.sqrt(x * x + y * y);
      const distPointer = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));

      const wave = Math.sin(distCenter * 2.3 - t * 2.8) * Math.exp(-distCenter * 0.24) * 0.34 * impactFactor;
      const pointerWave = Math.cos(distPointer * 3.1 - t * 3.2) * Math.exp(-distPointer * 0.55) * 0.14;
      pos.setZ(i, wave + pointerWave);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  });

  return (
    <mesh ref={meshRef} geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.3, 0]}>
      <meshStandardMaterial
        color="#241510"
        roughness={0.28}
        metalness={0.42}
        emissive="#4a2815"
        emissiveIntensity={0.28}
        wireframe={false}
      />
    </mesh>
  );
}

/**
 * Sculpted espresso droplet (Scene 1 -> falls into surface in Scene 2) with spring pointer orbit.
 */
function EspressoDroplet({
  scrollProgress,
  reducedMotion,
}: {
  scrollProgress: number;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const velRef = useRef({ x: 0, y: 0 });

  useFrame(({ clock, pointer }, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05);
    const t = reducedMotion ? 0 : clock.getElapsedTime();

    // Spring-damped horizontal follow of pointer
    const targetX = reducedMotion ? 0 : pointer.x * 0.75;
    const targetY = THREE.MathUtils.lerp(1.4, -1.45, Math.min(1, scrollProgress * 3.2)) + Math.sin(t * 1.4) * 0.12;

    const k = 28;
    const d = 6.5;
    velRef.current.x += ((targetX - groupRef.current.position.x) * k - velRef.current.x * d) * dt;
    velRef.current.y += ((targetY - groupRef.current.position.y) * k - velRef.current.y * d) * dt;

    groupRef.current.position.x += velRef.current.x * dt;
    groupRef.current.position.y += velRef.current.y * dt;
    groupRef.current.rotation.y = t * 0.35 + pointer.x * 0.4;
    groupRef.current.rotation.z = pointer.x * -0.15;

    // Fade droplet gracefully once immersed past Scene 2
    const scale = Math.max(0.01, 1.0 - Math.max(0, scrollProgress - 0.32) * 4.0);
    groupRef.current.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} position={[0, 1.4, 0]}>
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.72, 36, 36]} />
        <meshPhysicalMaterial
          color="#2c170f"
          roughness={0.14}
          metalness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.1}
          emissive="#c88b50"
          emissiveIntensity={0.14}
        />
      </mesh>
      <mesh position={[0, 0.78, 0]}>
        <coneGeometry args={[0.66, 1.15, 32]} />
        <meshPhysicalMaterial
          color="#2c170f"
          roughness={0.16}
          metalness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.12}
          emissive="#c88b50"
          emissiveIntensity={0.12}
        />
      </mesh>
    </group>
  );
}

/**
 * Flowing caramel-gold aroma & order particles traveling along a 3D cubic spline ribbon.
 * Speed reflects real café scenario (Calm vs Rush Hour).
 */
function FlowingAromaParticles({
  scrollProgress,
  isRush,
  reducedMotion,
}: {
  scrollProgress: number;
  isRush: boolean;
  reducedMotion: boolean;
}) {
  const count = 140;
  const pointsRef = useRef<THREE.Points>(null);

  const { positions, seeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      s[i] = i / count;
      pos[i * 3] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    return { positions: pos, seeds: s };
  }, []);

  useFrame(({ clock, pointer }) => {
    if (!pointsRef.current) return;
    const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const speed = isRush ? 0.24 : 0.11;
    const t = reducedMotion ? 0.5 : clock.getElapsedTime() * speed;

    for (let i = 0; i < count; i++) {
      const u = (seeds[i] + t) % 1;
      const angle = u * Math.PI * 4 + scrollProgress * Math.PI * 2;
      const radius = 1.6 + Math.sin(u * Math.PI) * (2.6 + scrollProgress * 1.4);
      const x = Math.cos(angle) * radius + pointer.x * 0.45;
      const y = -1.0 + Math.sin(u * Math.PI * 2) * 1.5 + (scrollProgress > 0.5 ? 0.3 : 0);
      const z = Math.sin(angle) * radius - scrollProgress * 2.2;
      attr.setXYZ(i, x, y, z);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={isRush ? 0.09 : 0.065}
        color={isRush ? "#E0AC76" : "#C88B50"}
        transparent
        opacity={0.85}
        sizeAttenuation
      />
    </points>
  );
}

/**
 * Miniature stylized living café tables + live ingredient stock orbs (Scenes 3 & 4).
 */
function LivingCafeNodes({
  scrollProgress,
  tables,
  overview,
  reducedMotion,
}: {
  scrollProgress: number;
  tables: TableItem[];
  overview: CafeOverview | null;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = reducedMotion ? 0 : clock.getElapsedTime();
    // Reveal smoothly starting in Scene 3 (scroll >= 0.35)
    const visibility = THREE.MathUtils.clamp((scrollProgress - 0.3) * 3.5, 0, 1);
    groupRef.current.scale.setScalar(0.001 + visibility * 0.999);
    groupRef.current.rotation.y = Math.sin(t * 0.2) * 0.08 + (scrollProgress - 0.5) * 0.6;
  });

  const displayTables = tables.length > 0 ? tables : [];
  const flowNodes = overview?.ingredientFlowNodes || [];

  return (
    <group ref={groupRef} position={[0, -0.85, -1.8]}>
      {/* Stylized 12 café tables reflecting real status */}
      {displayTables.map((tbl, idx) => {
        const col = idx % 4;
        const row = Math.floor(idx / 4);
        const x = (col - 1.5) * 1.35;
        const z = (row - 1) * 1.35;
        const color = tbl.status === "free" ? "#8B9B7E" : tbl.status === "reserved" ? "#C88B50" : "#5D453B";
        return (
          <group key={tbl.id} position={[x, 0, z]}>
            <mesh position={[0, 0.14, 0]}>
              <cylinderGeometry args={[0.36, 0.32, 0.1, 20]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={tbl.status === "free" ? 0.38 : 0.15} roughness={0.4} />
            </mesh>
            <mesh position={[0, -0.05, 0]}>
              <cylinderGeometry args={[0.07, 0.09, 0.35, 12]} />
              <meshStandardMaterial color="#3b261c" roughness={0.6} />
            </mesh>
          </group>
        );
      })}

      {/* 5 Live Ingredient Stock Nodes orbiting the kitchen bar (size/glow tied to real healthRatio!) */}
      {flowNodes.map((node, idx) => {
        const angle = (idx / Math.max(1, flowNodes.length)) * Math.PI * 2;
        const x = Math.cos(angle) * 3.2;
        const z = Math.sin(angle) * 2.4 - 1.5;
        const rad = 0.18 + Math.max(0.15, node.healthRatio) * 0.28;
        const color = node.status === "out" ? "#D86F51" : node.status === "low" ? "#C88B50" : "#4D9276";
        return (
          <mesh key={node.id} position={[x, 0.85 + Math.sin(idx) * 0.25, z]}>
            <sphereGeometry args={[rad, 24, 24]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.25} />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * Scroll-driven spring camera rig.
 */
function CameraRig({ scrollProgress, reducedMotion }: { scrollProgress: number; reducedMotion: boolean }) {
  const { camera } = useThree();
  const targetPos = useRef(new THREE.Vector3(0, 1.8, 6.2));

  useFrame(({ pointer }, delta) => {
    const dt = Math.min(delta, 0.05);
    // 5-chapter camera choreography
    const z = THREE.MathUtils.lerp(6.4, 3.8, Math.sin(scrollProgress * Math.PI)) + scrollProgress * 1.4;
    const y = THREE.MathUtils.lerp(1.4, 3.6, scrollProgress);
    const x = (reducedMotion ? 0 : pointer.x * 0.55) + Math.sin(scrollProgress * Math.PI * 1.6) * 1.1;

    targetPos.current.set(x, y, z);
    camera.position.lerp(targetPos.current, 1 - Math.exp(-4.5 * dt));
    camera.lookAt(0, -0.35, -scrollProgress * 1.4);
  });

  return null;
}

export function LivingEspressoScene({ scrollProgress, overview, tables, reducedMotion }: SceneProps) {
  const [webglReady, setWebglReady] = useState<boolean | null>(null);

  useEffect(() => {
    setWebglReady(detectWebGL());
  }, []);

  const fallback = (
    <EspressoFallbackVisual
      scrollProgress={scrollProgress}
      overview={overview}
      tables={tables}
      reason={reducedMotion ? "reduced-motion" : "webgl-unavailable"}
    />
  );

  if (webglReady === false) {
    return fallback;
  }

  return (
    <div className="h-full w-full" data-testid="hero-webgl-container">
      <WebGLErrorBoundary fallback={fallback}>
        {webglReady === null ? (
          fallback
        ) : (
          <Canvas
            dpr={[1, 1.5]}
            camera={{ position: [0, 1.6, 6.4], fov: 44 }}
            gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
          >
            <color attach="background" args={["#17120F"]} />
            <fog attach="fog" args={["#17120F", 7, 19]} />
            <ambientLight intensity={0.45} color="#fff2e2" />
            <directionalLight position={[5, 8, 5]} intensity={1.35} color="#f8cfa0" />
            <pointLight position={[-4, 2, 3]} intensity={1.1} color="#C88B50" />
            <pointLight position={[3, -1, -3]} intensity={0.8} color="#8B9B7E" />

            <CameraRig scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
            <EspressoDroplet scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
            <EspressoLiquidSurface scrollProgress={scrollProgress} reducedMotion={reducedMotion} />
            <FlowingAromaParticles
              scrollProgress={scrollProgress}
              isRush={overview?.scenario === "rush"}
              reducedMotion={reducedMotion}
            />
            <LivingCafeNodes
              scrollProgress={scrollProgress}
              tables={tables}
              overview={overview}
              reducedMotion={reducedMotion}
            />
          </Canvas>
        )}
      </WebGLErrorBoundary>
    </div>
  );
}
