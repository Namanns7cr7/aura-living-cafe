"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface CoffeeSteamProps {
  pointerRef: React.MutableRefObject<THREE.Vector2>;
  reducedMotion: boolean;
}

const STEAM_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec2 uPointerVel;
  uniform float uSeed;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;
    float h = uv.y;

    // Delicate upward curl and lateral pointer breeze response
    float swayA = sin(h * 4.2 - uTime * 0.85 + uSeed * 6.283) * 0.055 * h;
    float swayB = cos(h * 6.5 - uTime * 1.15 + uSeed * 3.7) * 0.024 * h;
    pos.x += swayA + uPointerVel.x * 0.18 * pow(h, 1.35);
    pos.z += swayB + uPointerVel.y * 0.12 * pow(h, 1.35);
    // Gentle plume expansion with height
    pos.x *= 1.0 + h * 0.65;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const STEAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    // Rise slowly upward
    float n1 = fbm(vec2(uv.x * 3.1 + uSeed * 4.0, uv.y * 2.4 - uTime * 0.28));
    float n2 = fbm(vec2(uv.x * 5.4 - uTime * 0.08, uv.y * 4.0 - uTime * 0.42 + uSeed));
    float vapor = smoothstep(0.36, 0.82, n1 * 0.65 + n2 * 0.35);

    // Soft Gaussian radial & vertical envelope so no plane edges ever appear
    float horizMask = exp(-pow((uv.x - 0.5) / 0.24, 2.0));
    float vertIn = smoothstep(0.0, 0.22, uv.y);
    float vertOut = 1.0 - smoothstep(0.32, 1.0, uv.y);

    float alpha = vapor * horizMask * vertIn * vertOut * 0.18;
    if (alpha < 0.004) discard;

    vec3 steamColor = mix(vec3(0.90, 0.84, 0.74), vec3(0.97, 0.94, 0.89), uv.y);
    gl_FragColor = vec4(steamColor, alpha);
    #include <colorspace_fragment>
  }
`;

export function CoffeeSteam({ pointerRef, reducedMotion }: CoffeeSteamProps) {
  const prevPtrRef = useRef(new THREE.Vector2());
  const velRef = useRef(new THREE.Vector2());

  const planes = useMemo(() => {
    const geom = new THREE.PlaneGeometry(0.68, 1.15, 6, 12);
    geom.translate(0, 0.575, 0);

    const items = [0, 1, 2].map((idx) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: STEAM_VERT,
        fragmentShader: STEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: idx * 0.23 + 0.11 },
          uPointerVel: { value: new THREE.Vector2() },
        },
      });
      return {
        mat,
        rotY: (idx / 3) * Math.PI,
        offsetX: (idx - 2) * 0.025,
        offsetZ: ((idx % 3) - 1) * 0.025,
      };
    });

    return { geom, items };
  }, []);

  useEffect(() => {
    return () => {
      planes.geom.dispose();
      planes.items.forEach((p) => p.mat.dispose());
    };
  }, [planes]);

  useFrame((state, delta) => {
    const dt = Math.max(0.001, Math.min(delta, 0.05));
    const t = reducedMotion ? 1.0 : state.clock.elapsedTime;

    const dx = pointerRef.current.x - prevPtrRef.current.x;
    const dy = pointerRef.current.y - prevPtrRef.current.y;
    prevPtrRef.current.copy(pointerRef.current);

    if (!reducedMotion) {
      const targetVx = THREE.MathUtils.clamp(dx / dt * 0.08, -0.4, 0.4);
      const targetVy = THREE.MathUtils.clamp(dy / dt * 0.08, -0.4, 0.4);
      velRef.current.x = THREE.MathUtils.lerp(velRef.current.x, targetVx, 1 - Math.exp(-5 * dt));
      velRef.current.y = THREE.MathUtils.lerp(velRef.current.y, targetVy, 1 - Math.exp(-5 * dt));
    } else {
      velRef.current.set(0, 0);
    }

    for (const item of planes.items) {
      item.mat.uniforms.uTime.value = t;
      (item.mat.uniforms.uPointerVel.value as THREE.Vector2).copy(velRef.current);
    }
  });

  return (
    <group position={[0, 0.56, 0]}>
      {planes.items.map((item, idx) => (
        <mesh
          key={idx}
          geometry={planes.geom}
          material={item.mat}
          position={[item.offsetX, 0, item.offsetZ]}
          rotation={[0, item.rotY, 0]}
        />
      ))}
    </group>
  );
}
