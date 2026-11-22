"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { CafeOverview, TableItem } from "@/lib/types";
import {
  createCarafeGeometry,
  createMilkPitcherGeometry,
  createPortafilterSpoutGeometry,
  createTastingDishGeometry,
} from "./coffeeGeometry";
import { createGlazeTexture } from "./coffeeTextures";

interface CafeEnvironment3DProps {
  overview: CafeOverview | null;
  tables: TableItem[];
  isSoftware?: boolean;
}

const CUP_MODEL_URL = "/models/coffee/espresso-cup.glb";
const DISH_BEAN_MODEL_URL = "/models/coffee/coffee-bean-sculpt.glb";

const CAFE_TABLE_LAYOUT = [
  { id: "Q1", pos: [-2.4, -0.82, -3.7] as [number, number, number], radius: 0.42 },
  { id: "Q2", pos: [-0.95, -0.82, -4.0] as [number, number, number], radius: 0.42 },
  { id: "W1", pos: [0.85, -0.82, -3.7] as [number, number, number], radius: 0.42 },
  { id: "S1", pos: [2.25, -0.82, -3.6] as [number, number, number], radius: 0.48 },
  { id: "W2", pos: [-1.55, -0.82, -5.2] as [number, number, number], radius: 0.44 },
  { id: "S2", pos: [0.45, -0.82, -5.3] as [number, number, number], radius: 0.52 },
];

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.14, size / 2, size / 2, size * 0.5);
  grad.addColorStop(0.0, "rgba(12, 6, 4, 0.72)");
  grad.addColorStop(0.55, "rgba(12, 6, 4, 0.36)");
  grad.addColorStop(1.0, "rgba(12, 6, 4, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export const CafeEnvironment3D = React.memo(function CafeEnvironment3D({
  overview,
  tables,
  isSoftware = false,
}: CafeEnvironment3DProps) {
  const cupGltf = useGLTF(CUP_MODEL_URL);
  const dishBeanGltf = useGLTF(DISH_BEAN_MODEL_URL);
  const dishBeansMeshRef = useRef<THREE.InstancedMesh>(null);

  const walnutBaseMaps = useTexture({
    map: "/textures/coffee/walnut-albedo.jpg",
    normalMap: "/textures/coffee/walnut-normal.jpg",
    roughnessMap: "/textures/coffee/walnut-roughness.jpg",
  });

  const glazeTex = useMemo(() => createGlazeTexture(), []);
  const softShadowTex = useMemo(() => (isSoftware ? createContactShadowTexture() : null), [isSoftware]);

  const walnutCounterTextures = useMemo(() => {
    const map = walnutBaseMaps.map.clone();
    const normalMap = walnutBaseMaps.normalMap.clone();
    const roughnessMap = walnutBaseMaps.roughnessMap.clone();

    map.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = THREE.NoColorSpace;
    roughnessMap.colorSpace = THREE.NoColorSpace;

    [map, normalMap, roughnessMap].forEach((tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(5.4, 2.0);
      tex.anisotropy = isSoftware ? 2 : 8;
      tex.needsUpdate = true;
    });

    return {
      map,
      normalMap,
      roughnessMap,
      dispose: () => {
        map.dispose();
        normalMap.dispose();
        roughnessMap.dispose();
      },
    };
  }, [walnutBaseMaps, isSoftware]);

  const heroCupScene = useMemo(() => {
    const root = cupGltf.scene.clone(true);
    const createdMats: THREE.Material[] = [];

    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.castShadow = !isSoftware;
      obj.receiveShadow = !isSoftware;

      if (obj.material instanceof THREE.MeshStandardMaterial) {
        if (isSoftware) {
          // Standard PBR ceramic on CPU software rasterizers (skips clearcoat branch while staying glossy)
          const fastMat = new THREE.MeshStandardMaterial({
            map: obj.material.map,
            roughnessMap: obj.material.roughnessMap,
            color: new THREE.Color("#FFFDF9"),
            roughness: 0.45,
            metalness: 0.0,
            side: THREE.DoubleSide,
          });
          obj.material = fastMat;
          createdMats.push(fastMat);
        } else {
          const mat = obj.material.clone();
          mat.envMapIntensity = 1.28;
          mat.roughness = 0.92;
          mat.metalness = 0.0;
          if (mat instanceof THREE.MeshPhysicalMaterial) {
            mat.clearcoat = 0.58;
            mat.clearcoatRoughness = 0.14;
          }
          mat.needsUpdate = true;
          obj.material = mat;
          createdMats.push(mat);
        }
      }
    });

    return { root, createdMats };
  }, [cupGltf, isSoftware]);

  const dishBeanAsset = useMemo(() => {
    let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(0.04, 8, 8);
    let material: THREE.Material = new THREE.MeshStandardMaterial({ color: "#4A2C1B", roughness: 0.48 });
    let found = false;

    dishBeanGltf.scene.traverse((obj) => {
      if (!found && obj instanceof THREE.Mesh && obj.geometry) {
        geometry = obj.geometry;
        if (obj.material instanceof THREE.MeshStandardMaterial) {
          const cloned = obj.material.clone();
          cloned.envMapIntensity = 1.25;
          cloned.roughness = 0.48;
          material = cloned;
        }
        found = true;
      }
    });

    return { geometry, material };
  }, [dishBeanGltf]);

  const geoms = useMemo(
    () => ({
      spout: createPortafilterSpoutGeometry(),
      pitcher: createMilkPitcherGeometry(),
      carafe: createCarafeGeometry(),
      dish: createTastingDishGeometry(),
    }),
    []
  );

  const mats = useMemo(() => {
    const walnutMat = new THREE.MeshStandardMaterial({
      map: walnutCounterTextures.map,
      roughnessMap: walnutCounterTextures.roughnessMap,
      normalMap: isSoftware ? null : walnutCounterTextures.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.88,
      metalness: 0.03,
      envMapIntensity: 1.05,
    });

    const cafeWoodMat = new THREE.MeshStandardMaterial({
      map: walnutBaseMaps.map,
      roughnessMap: isSoftware ? null : walnutBaseMaps.roughnessMap,
      roughness: 0.85,
      metalness: 0.02,
      envMapIntensity: 0.85,
    });

    const stonewareDishMat = new THREE.MeshStandardMaterial({
      color: "#2E211A",
      roughness: 0.72,
      metalness: 0.04,
      envMapIntensity: 1.1,
    });

    const glazeMat = isSoftware
      ? new THREE.MeshStandardMaterial({
          map: glazeTex,
          roughness: 0.24,
          metalness: 0.02,
          side: THREE.DoubleSide,
        })
      : new THREE.MeshPhysicalMaterial({
          map: glazeTex,
          roughness: 0.2,
          metalness: 0.02,
          clearcoat: 0.48,
          clearcoatRoughness: 0.14,
          side: THREE.DoubleSide,
        });

    const steelMat = new THREE.MeshStandardMaterial({
      color: "#C4BCB2",
      roughness: 0.24,
      metalness: 0.88,
      envMapIntensity: 1.35,
    });

    const pewterMat = new THREE.MeshStandardMaterial({
      color: "#3F352E",
      roughness: 0.34,
      metalness: 0.78,
      envMapIntensity: 1.2,
    });

    const glassMat = isSoftware
      ? new THREE.MeshStandardMaterial({
          color: "#DDD4C8",
          roughness: 0.14,
          metalness: 0.08,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial({
          color: "#EAE2D7",
          roughness: 0.08,
          metalness: 0.08,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.65,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
        });

    const oatMilkMat = new THREE.MeshStandardMaterial({
      color: "#EDE0CC",
      roughness: 0.22,
      metalness: 0.0,
    });

    const coldBrewLiquidMat = new THREE.MeshStandardMaterial({
      color: "#261209",
      roughness: 0.14,
      metalness: 0.02,
    });

    const warmPlasterMat = new THREE.MeshStandardMaterial({
      color: "#2B1D15",
      roughness: 0.92,
      metalness: 0.0,
    });

    const floorMat = new THREE.MeshStandardMaterial({
      color: "#180F0A",
      roughness: 0.84,
      metalness: 0.02,
    });

    const brassMat = new THREE.MeshStandardMaterial({
      color: "#C4915C",
      roughness: 0.28,
      metalness: 0.78,
      envMapIntensity: 1.25,
    });

    return {
      walnutMat,
      cafeWoodMat,
      stonewareDishMat,
      glazeMat,
      steelMat,
      pewterMat,
      glassMat,
      oatMilkMat,
      coldBrewLiquidMat,
      warmPlasterMat,
      floorMat,
      brassMat,
    };
  }, [walnutCounterTextures, walnutBaseMaps, glazeTex, isSoftware]);

  useEffect(() => {
    return () => {
      walnutCounterTextures.dispose();
      glazeTex.dispose();
      softShadowTex?.dispose();
      heroCupScene.createdMats.forEach((m) => m.dispose());
      dishBeanAsset.material.dispose();
      Object.values(geoms).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    };
  }, [walnutCounterTextures, glazeTex, softShadowTex, heroCupScene, dishBeanAsset, geoms, mats]);

  const oatNode = overview?.ingredientFlowNodes.find((n) => n.id.includes("oat"));
  const espressoNode = overview?.ingredientFlowNodes.find((n) => n.id.includes("espresso"));
  const coldNode = overview?.ingredientFlowNodes.find((n) => n.id.includes("cold"));

  const milkFillScale = Math.max(0.25, Math.min(1.0, oatNode ? oatNode.healthRatio : 0.72));
  const beanMoundCount = Math.max(6, Math.min(14, Math.round((espressoNode?.healthRatio ?? 0.85) * 14)));
  const coldFillScale = Math.max(0.25, Math.min(1.0, coldNode ? coldNode.healthRatio : 0.82));

  useEffect(() => {
    const mesh = dishBeansMeshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < beanMoundCount; i++) {
      const ring = i < 5 ? 0.068 : i < 10 ? 0.135 : 0.185;
      const angle = i * 2.39996;
      const y = 0.048 + (1 - ring / 0.24) * 0.036;
      dummy.position.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
      dummy.rotation.set((i % 3) * 0.35 - 0.3, angle, ((i * 7) % 5) * 0.25 - 0.5);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [beanMoundCount]);

  return (
    <group>
      {/* --- FOREGROUND ESPRESSO BAR COUNTERTOP (CC0 Walnut Wood051 PBR, top strictly at y = 0) --- */}
      <mesh position={[0.4, -0.07, 0.45]} receiveShadow={!isSoftware} castShadow={!isSoftware} material={mats.walnutMat}>
        <boxGeometry args={[14.0, 0.14, 4.1]} />
      </mesh>
      <mesh position={[0.4, -0.45, -1.6]} receiveShadow={!isSoftware} material={mats.warmPlasterMat}>
        <boxGeometry args={[14.0, 0.72, 0.06]} />
      </mesh>

      {/* Soft contact shadow plane on software WebGL so saucer stays grounded cleanly */}
      {isSoftware && softShadowTex && (
        <mesh position={[-0.02, 0.002, 0.02]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1.95, 1.95]} />
          <meshBasicMaterial map={softShadowTex} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}

      {/* --- HERO IMPORTED CERAMIC CUP & SAUCER (CC BY 4.0 senorp3dro, normalized at origin) --- */}
      <group position={[0, 0, 0]}>
        <primitive object={heroCupScene.root} />

        {/* Overhead espresso portafilter spout (Scene 1 pour origin) */}
        <mesh position={[0, 1.54, 0]} geometry={geoms.spout} material={mats.pewterMat} castShadow={!isSoftware} />
      </group>

      {/* --- SCENE 3: FROM BEAN TO CUP CRAFT STILL LIFE (1 instanced draw call for dish beans) --- */}
      <group position={[2.25, 0, -0.25]}>
        <group position={[-0.36, 0, 0.14]}>
          <mesh geometry={geoms.dish} material={mats.stonewareDishMat} castShadow={!isSoftware} receiveShadow={!isSoftware} />
          <instancedMesh
            ref={dishBeansMeshRef}
            args={[dishBeanAsset.geometry, dishBeanAsset.material, beanMoundCount]}
            castShadow={!isSoftware}
          />
        </group>

        <group position={[0.16, 0, -0.14]}>
          <mesh geometry={geoms.pitcher} material={mats.steelMat} castShadow={!isSoftware} receiveShadow={!isSoftware} />
          <mesh position={[0, 0.14 + milkFillScale * 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.175, 32]} />
            <primitive object={mats.oatMilkMat} attach="material" />
          </mesh>
        </group>

        <group position={[0.56, 0, 0.18]}>
          <mesh position={[0, 0.04 + coldFillScale * 0.12, 0]} material={mats.coldBrewLiquidMat}>
            <cylinderGeometry args={[0.195, 0.225, 0.08 + coldFillScale * 0.22, 32]} />
          </mesh>
          <mesh geometry={geoms.carafe} material={mats.glassMat} />
        </group>

        <mesh position={[0.15, 0.022, 0.34]} castShadow={!isSoftware} receiveShadow={!isSoftware} material={mats.brassMat}>
          <cylinderGeometry args={[0.11, 0.115, 0.044, 28]} />
        </mesh>
        <mesh position={[0.15, 0.095, 0.34]} castShadow={!isSoftware} material={mats.cafeWoodMat}>
          <cylinderGeometry args={[0.045, 0.032, 0.11, 24]} />
        </mesh>
      </group>

      {/* --- SCENE 2: THE HUMAN EXPERIENCE — WARM SUNLIT CAFÉ ROOM --- */}
      <group>
        <mesh position={[0, -0.82, -4.0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={!isSoftware} material={mats.floorMat}>
          <planeGeometry args={[18, 10]} />
        </mesh>

        <mesh position={[0, 1.4, -6.5]} receiveShadow={!isSoftware} material={mats.warmPlasterMat}>
          <planeGeometry args={[18, 5.5]} />
        </mesh>

        {/* Architectural walnut slatted partition wall in café corner */}
        <group position={[-3.3, 0.6, -4.4]}>
          {[-0.45, -0.22, 0, 0.22, 0.45].map((sx) => (
            <mesh key={sx} position={[sx, 0, 0]} material={mats.cafeWoodMat}>
              <boxGeometry args={[0.07, 2.8, 0.09]} />
            </mesh>
          ))}
        </group>

        {CAFE_TABLE_LAYOUT.map((slot, idx) => {
          const liveTable = tables.find((t) => t.id === slot.id) || tables[idx];
          const isOccupied = liveTable?.status === "occupied" || liveTable?.status === "reserved";
          return (
            <group key={slot.id} position={slot.pos}>
              <mesh position={[0, 0.72, 0]} receiveShadow={!isSoftware} material={mats.cafeWoodMat}>
                <cylinderGeometry args={[slot.radius, slot.radius, 0.04, 24]} />
              </mesh>
              <mesh position={[0, 0.36, 0]} material={mats.pewterMat}>
                <cylinderGeometry args={[0.04, 0.055, 0.7, 12]} />
              </mesh>
              <mesh position={[0, 0.015, 0]} material={mats.pewterMat}>
                <cylinderGeometry args={[0.22, 0.24, 0.03, 16]} />
              </mesh>

              {[-1, 1].map((side) => (
                <group
                  key={side}
                  position={[side * (slot.radius + 0.24), 0, 0]}
                  rotation={[0, side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]}
                >
                  <mesh position={[0, 0.44, 0]} material={mats.cafeWoodMat}>
                    <cylinderGeometry args={[0.17, 0.17, 0.03, 14]} />
                  </mesh>
                  <mesh position={[0, 0.22, 0]} material={mats.cafeWoodMat}>
                    <cylinderGeometry args={[0.025, 0.035, 0.44, 8]} />
                  </mesh>
                  <mesh position={[0, 0.66, -0.14]} rotation={[0.08, 0, 0]} material={mats.cafeWoodMat}>
                    <boxGeometry args={[0.28, 0.36, 0.028]} />
                  </mesh>
                </group>
              ))}

              <mesh position={[0.12, 0.77, 0.08]} material={mats.glazeMat}>
                <cylinderGeometry args={[0.045, 0.036, 0.06, 14]} />
              </mesh>

              <group position={[-0.12, 0.74, -0.06]}>
                <mesh position={[0, 0.07, 0]} material={mats.brassMat}>
                  <cylinderGeometry args={[0.028, 0.045, 0.14, 16]} />
                </mesh>
                <mesh position={[0, 0.155, 0]}>
                  <cylinderGeometry args={[0.055, 0.078, 0.075, 20]} />
                  <meshStandardMaterial
                    color="#E6D5BD"
                    emissive="#D99B58"
                    emissiveIntensity={isOccupied ? 0.5 : 0.12}
                    roughness={0.5}
                  />
                </mesh>
              </group>
            </group>
          );
        })}
      </group>
    </group>
  );
});

useGLTF.preload(CUP_MODEL_URL);
useGLTF.preload(DISH_BEAN_MODEL_URL);
