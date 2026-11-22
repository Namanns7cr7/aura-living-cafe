"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  CylinderCollider,
  InstancedRigidBodies,
  InstancedRigidBodyProps,
  RapierRigidBody,
  RigidBody,
  RoundCuboidCollider,
} from "@react-three/rapier";
import * as THREE from "three";

interface CoffeeBeansPhysicsProps {
  isMobile: boolean;
  isSoftware?: boolean;
  reducedMotion: boolean;
  scrollRef: React.MutableRefObject<number>;
  pointerRef: React.MutableRefObject<THREE.Vector2>;
  clickPulseRef: React.MutableRefObject<{ pending: boolean; ndc: THREE.Vector2 }>;
  dropNonce: number;
  onReady?: (count: number) => void;
}

const SCAN_BEAN_URL = "/models/coffee/coffee-bean-scan.glb";
const SCULPT_BEAN_URL = "/models/coffee/coffee-bean-sculpt.glb";

const ROAST_TINT_PALETTE = [
  "#FFFFFF",
  "#F0DEC8",
  "#E2CBB5",
  "#F5E6D3",
  "#D4B9A2",
];

function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function extractFirstMeshAsset(sceneRoot: THREE.Object3D, roughness: number, skipNormalMap: boolean) {
  let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(0.04, 8, 8);
  let material = new THREE.MeshStandardMaterial({ color: "#FFFFFF", roughness, metalness: 0.02 });
  let found = false;

  sceneRoot.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh && obj.geometry) {
      geometry = obj.geometry;
      if (obj.material instanceof THREE.MeshStandardMaterial) {
        const cloned = obj.material.clone();
        // Neutral white multiplier lets InstancedMesh instanceColor vary roast shades cleanly
        cloned.color.set("#FFFFFF");
        cloned.roughness = roughness;
        cloned.metalness = 0.02;
        cloned.envMapIntensity = 1.25;
        if (skipNormalMap) {
          cloned.normalMap = null;
        }
        cloned.needsUpdate = true;
        material = cloned;
      }
      found = true;
    }
  });

  return { geometry, material };
}

interface BeanLayoutItem {
  key: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  tintHex: string;
}

export function CoffeeBeansPhysics({
  isMobile,
  isSoftware = false,
  reducedMotion,
  scrollRef,
  pointerRef,
  clickPulseRef,
  dropNonce,
  onReady,
}: CoffeeBeansPhysicsProps) {
  const lowDetail = isMobile || isSoftware;
  const scanCount = lowDetail ? 8 : 14;
  const sculptCount = lowDetail ? 10 : 18;
  const totalCount = scanCount + sculptCount;

  const scanBodiesRef = useRef<(RapierRigidBody | null)[]>([]);
  const sculptBodiesRef = useRef<(RapierRigidBody | null)[]>([]);
  const scanMeshRef = useRef<THREE.InstancedMesh>(null);
  const sculptMeshRef = useRef<THREE.InstancedMesh>(null);

  const lastDropNonceRef = useRef(dropNonce);
  const prevHitRef = useRef<THREE.Vector3 | null>(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const tablePlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.025), []);
  const hitPoint = useMemo(() => new THREE.Vector3(), []);

  const { camera } = useThree();

  const scanGltf = useGLTF(SCAN_BEAN_URL);
  const sculptGltf = useGLTF(SCULPT_BEAN_URL);

  const scanAsset = useMemo(() => extractFirstMeshAsset(scanGltf.scene, 0.44, isSoftware), [scanGltf, isSoftware]);
  const sculptAsset = useMemo(() => extractFirstMeshAsset(sculptGltf.scene, 0.48, isSoftware), [sculptGltf, isSoftware]);

  useEffect(() => {
    return () => {
      scanAsset.material.dispose();
      sculptAsset.material.dispose();
    };
  }, [scanAsset, sculptAsset]);

  const { scanLayouts, sculptLayouts } = useMemo(() => {
    const rand = seededRand(202611);
    const makeLayout = (keyPrefix: string, index: number): BeanLayoutItem => {
      // Cluster naturally around the visible perimeter of the saucer without overlapping r <= 0.65
      const sector = index % 3;
      const baseAngle =
        sector === 0
          ? -0.32 + rand() * 0.92 // right flank beside handle
          : sector === 1
          ? 0.65 + rand() * 0.88 // front-right foreground on walnut
          : 1.82 + rand() * 0.95; // front-left beside saucer
      const radius = 0.78 + rand() * 0.40;
      const x = Math.cos(baseAngle) * radius;
      const z = Math.sin(baseAngle) * radius;
      const dropY = reducedMotion ? 0.030 : 0.14 + (index % 5) * 0.048 + rand() * 0.03;
      const rx = reducedMotion ? (rand() > 0.5 ? 0.05 : Math.PI - 0.08) : (rand() - 0.5) * 0.9;
      const ry = rand() * Math.PI * 2;
      const rz = reducedMotion ? (rand() - 0.5) * 0.15 : (rand() - 0.5) * 0.9;
      const s = 0.92 + rand() * 0.16;

      return {
        key: `${keyPrefix}-${index}`,
        position: [x, dropY, z],
        rotation: [rx, ry, rz],
        scale: [s, s, s],
        tintHex: ROAST_TINT_PALETTE[index % ROAST_TINT_PALETTE.length],
      };
    };

    const sLayouts: BeanLayoutItem[] = [];
    const cLayouts: BeanLayoutItem[] = [];
    for (let i = 0; i < totalCount; i++) {
      if (i < scanCount) {
        sLayouts.push(makeLayout("bean-scan", i));
      } else {
        cLayouts.push(makeLayout("bean-sculpt", i));
      }
    }
    return { scanLayouts: sLayouts, sculptLayouts: cLayouts };
  }, [scanCount, totalCount, reducedMotion]);

  const toInstances = (layouts: BeanLayoutItem[]): InstancedRigidBodyProps[] =>
    layouts.map((item) => ({
      key: item.key,
      position: item.position,
      rotation: item.rotation,
      scale: item.scale,
      mass: 0.014,
      restitution: 0.18,
      friction: 0.68,
      linearDamping: 0.55,
      angularDamping: 0.68,
      canSleep: true,
    }));

  const scanInstances = useMemo(() => toInstances(scanLayouts), [scanLayouts]);
  const sculptInstances = useMemo(() => toInstances(sculptLayouts), [sculptLayouts]);

  // Apply natural subtle per-bean roast variation via instanceColor
  useEffect(() => {
    const color = new THREE.Color();
    if (scanMeshRef.current) {
      scanLayouts.forEach((item, i) => {
        color.set(item.tintHex);
        scanMeshRef.current!.setColorAt(i, color);
      });
      if (scanMeshRef.current.instanceColor) {
        scanMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
    if (sculptMeshRef.current) {
      sculptLayouts.forEach((item, i) => {
        color.set(item.tintHex);
        sculptMeshRef.current!.setColorAt(i, color);
      });
      if (sculptMeshRef.current.instanceColor) {
        sculptMeshRef.current.instanceColor.needsUpdate = true;
      }
    }
  }, [scanLayouts, sculptLayouts]);

  useEffect(() => {
    onReady?.(totalCount);
  }, [totalCount, onReady]);

  // Reset / re-drop beans cleanly when user triggers Drop Beans
  useEffect(() => {
    if (lastDropNonceRef.current === dropNonce) return;
    lastDropNonceRef.current = dropNonce;

    const resetGroup = (bodies: (RapierRigidBody | null)[], layouts: BeanLayoutItem[]) => {
      layouts.forEach((layout, i) => {
        const body = bodies[i];
        if (!body) return;
        try {
          body.setTranslation(
            {
              x: layout.position[0] + (Math.random() - 0.5) * 0.08,
              y: 0.34 + (i % 7) * 0.11,
              z: layout.position[2] + (Math.random() - 0.5) * 0.08,
            },
            true
          );
          body.setLinvel({ x: (Math.random() - 0.5) * 0.15, y: -0.25, z: (Math.random() - 0.5) * 0.15 }, true);
          body.setAngvel(
            {
              x: (Math.random() - 0.5) * 4.5,
              y: (Math.random() - 0.5) * 3.5,
              z: (Math.random() - 0.5) * 4.5,
            },
            true
          );
          body.wakeUp();
        } catch {
          // ignore if body is unmounting
        }
      });
    };

    resetGroup(scanBodiesRef.current, scanLayouts);
    resetGroup(sculptBodiesRef.current, sculptLayouts);
  }, [dropNonce, scanLayouts, sculptLayouts]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    if (scrollRef.current > 0.72) return;

    const dt = Math.min(delta, 0.05);
    const allBodies: (RapierRigidBody | null)[] = [...scanBodiesRef.current, ...sculptBodiesRef.current];
    if (allBodies.length === 0) return;

    // Handle click scatter impulse
    if (clickPulseRef.current.pending) {
      clickPulseRef.current.pending = false;
      raycaster.setFromCamera(clickPulseRef.current.ndc, camera);
      if (raycaster.ray.intersectPlane(tablePlane, hitPoint)) {
        for (let i = 0; i < allBodies.length; i++) {
          const b = allBodies[i];
          if (!b) continue;
          try {
            const p = b.translation();
            const dx = p.x - hitPoint.x;
            const dz = p.z - hitPoint.z;
            const distSq = dx * dx + dz * dz;
            if (distSq < 0.55 && distSq > 0.0001) {
              const dist = Math.sqrt(distSq);
              const strength = (1 - dist / 0.74) * 0.00125;
              b.wakeUp();
              b.applyImpulse(
                {
                  x: (dx / dist) * strength,
                  y: strength * 0.42,
                  z: (dz / dist) * strength,
                },
                true
              );
              b.applyTorqueImpulse(
                {
                  x: (dz / dist) * strength * 0.028,
                  y: (Math.random() - 0.5) * 0.00003,
                  z: (-dx / dist) * strength * 0.028,
                },
                true
              );
            }
          } catch {
            // ignore transient body errors
          }
        }
      }
    }

    // Subtle physically plausible nudge when cursor glides near beans
    raycaster.setFromCamera(pointerRef.current, camera);
    if (raycaster.ray.intersectPlane(tablePlane, hitPoint)) {
      const prev = prevHitRef.current;
      if (prev) {
        const vx = hitPoint.x - prev.x;
        const vz = hitPoint.z - prev.z;
        const speed = Math.hypot(vx, vz);

        if (speed > 0.003 && speed < 0.65 && dt > 0) {
          const dirX = vx / speed;
          const dirZ = vz / speed;
          const pushScale = Math.min(speed * 0.0038, 0.00052);

          for (let i = 0; i < allBodies.length; i++) {
            const b = allBodies[i];
            if (!b) continue;
            try {
              const p = b.translation();
              const dx = p.x - hitPoint.x;
              const dz = p.z - hitPoint.z;
              const dist = Math.hypot(dx, dz);
              if (dist < 0.42 && p.y < 0.25) {
                const falloff = 1 - dist / 0.42;
                const impX = (dirX * 0.65 + (dx / Math.max(0.05, dist)) * 0.35) * pushScale * falloff;
                const impZ = (dirZ * 0.65 + (dz / Math.max(0.05, dist)) * 0.35) * pushScale * falloff;
                b.wakeUp();
                b.applyImpulse({ x: impX, y: 0.00004 * falloff, z: impZ }, true);
                b.applyTorqueImpulse(
                  { x: impZ * 0.025, y: 0, z: -impX * 0.025 },
                  true
                );
              }
            } catch {
              // ignore transient body errors
            }
          }
        }
        prev.copy(hitPoint);
      } else {
        prevHitRef.current = hitPoint.clone();
      }
    }
  });

  return (
    <group>
      {/* Fixed physics colliders matching imported espresso-cup.glb & walnut bar */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[7.0, 0.07, 2.05]} position={[0.4, -0.07, 0.45]} friction={0.72} restitution={0.16} />
        <CylinderCollider args={[0.048, 0.65]} position={[0, 0.048, 0]} friction={0.58} restitution={0.22} />
        <CylinderCollider args={[0.315, 0.57]} position={[0, 0.315, 0]} friction={0.55} restitution={0.22} />
        <CuboidCollider args={[6.5, 0.15, 0.05]} position={[0.4, 0.08, -1.52]} friction={0.5} restitution={0.2} />
      </RigidBody>

      {/* Group 1: Macro-scanned photogrammetry coffee beans (kouitimizuno, CC BY 4.0) */}
      <InstancedRigidBodies
        ref={scanBodiesRef}
        instances={scanInstances}
        colliders={false}
        colliderNodes={[<RoundCuboidCollider key="bean-scan-col" args={[0.024, 0.014, 0.047, 0.013]} />]}
      >
        <instancedMesh
          ref={scanMeshRef}
          args={[scanAsset.geometry, scanAsset.material, scanInstances.length]}
          castShadow={!isSoftware}
          receiveShadow={!isSoftware}
          frustumCulled={false}
        />
      </InstancedRigidBodies>

      {/* Group 2: Sculpted roasted coffee beans (mikethornley, CC BY 4.0) */}
      <InstancedRigidBodies
        ref={sculptBodiesRef}
        instances={sculptInstances}
        colliders={false}
        colliderNodes={[<RoundCuboidCollider key="bean-sculpt-col" args={[0.038, 0.008, 0.044, 0.012]} />]}
      >
        <instancedMesh
          ref={sculptMeshRef}
          args={[sculptAsset.geometry, sculptAsset.material, sculptInstances.length]}
          castShadow={!isSoftware}
          receiveShadow={!isSoftware}
          frustumCulled={false}
        />
      </InstancedRigidBodies>
    </group>
  );
}

useGLTF.preload(SCAN_BEAN_URL);
useGLTF.preload(SCULPT_BEAN_URL);
