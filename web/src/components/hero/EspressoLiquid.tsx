"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface EspressoLiquidProps {
  scrollRef: React.MutableRefObject<number>;
  cremaNoiseTex: THREE.Texture;
  pourNonce: number;
  reducedMotion: boolean;
}

function createConcentricDiscGeometry(radius: number, radialSegs = 64, ringSegs = 28): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];

  for (let r = 1; r <= ringSegs; r++) {
    const frac = r / ringSegs;
    const rad = radius * frac;
    for (let s = 0; s <= radialSegs; s++) {
      const theta = (s / radialSegs) * Math.PI * 2;
      const x = Math.cos(theta) * rad;
      const z = Math.sin(theta) * rad;
      positions.push(x, 0, z);
      uvs.push(0.5 + (x / (radius * 2)), 0.5 + (z / (radius * 2)));
    }
  }

  const ringStride = radialSegs + 1;
  // Center fan
  for (let s = 0; s < radialSegs; s++) {
    indices.push(0, 1 + s + 1, 1 + s);
  }
  // Outer rings
  for (let r = 1; r < ringSegs; r++) {
    const rowA = 1 + (r - 1) * ringStride;
    const rowB = 1 + r * ringStride;
    for (let s = 0; s < radialSegs; s++) {
      const a = rowA + s;
      const b = rowA + s + 1;
      const c = rowB + s;
      const d = rowB + s + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

const ESPRESSO_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPourIntensity;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vRadiusNorm;
  varying float vWaveHeight;

  float waveHeight(vec2 xz) {
    float r = length(xz);
    // Damped viscous capillary ripples from center pour impact
    float impactWave = sin(r * 46.0 - uTime * 5.8) * exp(-r * 7.2) * 0.0052 * uPourIntensity;
    float secondHarmonic = sin(r * 78.0 - uTime * 8.1 + 1.4) * exp(-r * 10.5) * 0.0020 * uPourIntensity;
    float microSwell = sin(xz.x * 9.0 + uTime * 0.75) * cos(xz.y * 8.0 - uTime * 0.6) * 0.0008;
    // Slight concave meniscus lift right at ceramic edge
    float meniscus = smoothstep(uRadius * 0.78, uRadius, r) * 0.0032;
    return impactWave + secondHarmonic + microSwell + meniscus;
  }

  void main() {
    vUv = uv;
    vec2 xz = position.xz;
    float h = waveHeight(xz);
    float eps = 0.006;
    float hx = waveHeight(xz + vec2(eps, 0.0)) - h;
    float hz = waveHeight(xz + vec2(0.0, eps)) - h;
    vec3 localN = normalize(vec3(-hx / eps, 1.0, -hz / eps));

    vNormalW = normalize(mat3(modelMatrix) * localN);
    vRadiusNorm = clamp(length(xz) / uRadius, 0.0, 1.0);
    vWaveHeight = h;

    vec4 world = modelMatrix * vec4(position.x, position.y + h, position.z, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ESPRESSO_FRAG = /* glsl */ `
  uniform sampler2D uCremaTex;
  uniform float uTime;
  uniform float uPourIntensity;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vRadiusNorm;
  varying float vWaveHeight;

  void main() {
    vec2 centered = vUv - 0.5;
    float r = length(centered) * 2.0;
    float angle = atan(centered.y, centered.x);

    // Subtle radial crema advection outward during pour
    float swirlAngle = angle + (1.0 - smoothstep(0.0, 0.85, r)) * 0.35 + sin(uTime * 0.15) * 0.05;
    vec2 swirlUv = vec2(
      0.5 + cos(swirlAngle) * r * 0.5,
      0.5 + sin(swirlAngle) * r * 0.5
    );

    vec3 noiseA = texture2D(uCremaTex, swirlUv).rgb;
    vec3 noiseB = texture2D(uCremaTex, vUv * 1.45 - vec2(uTime * 0.008, uTime * 0.005)).rgb;

    float mottle = mix(noiseA.r, noiseB.g, 0.42);
    float tigerBand = smoothstep(0.28, 0.78, noiseA.b * 0.75 + mottle * 0.35);

    vec3 darkHeart = vec3(0.014, 0.005, 0.002);   // linear dark espresso heart
    vec3 roastAmber = vec3(0.09, 0.032, 0.011);   // linear roasted mahogany
    vec3 goldenCrema = vec3(0.36, 0.165, 0.056);  // linear caramel hazelnut crema (#BD8755)
    vec3 foamHighlight = vec3(0.56, 0.30, 0.11);  // warm golden crema highlights

    // Outer edge collects richer crema, center shows subtle dark eye + impact foam
    float cremaWeight = smoothstep(0.08, 0.92, tigerBand * 0.82 + vRadiusNorm * 0.22);
    vec3 baseCol = mix(darkHeart, roastAmber, smoothstep(0.14, 0.62, mottle));
    baseCol = mix(baseCol, goldenCrema, cremaWeight * 0.88);
    baseCol = mix(baseCol, foamHighlight, smoothstep(0.76, 0.96, noiseB.g) * 0.32);

    // Subtle froth ring around active pour impact center
    float centerFroth = exp(-pow(vRadiusNorm / 0.16, 2.0)) * uPourIntensity * 0.38;
    baseCol = mix(baseCol, foamHighlight * 0.88, centerFroth);

    // Meniscus darkening right against warm glazed ceramic wall
    float edgeDark = smoothstep(0.88, 1.0, vRadiusNorm);
    baseCol = mix(baseCol, darkHeart * 0.85, edgeDark * 0.45);

    // Physical lighting matching left-side warm window key light
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(vec3(-0.62, 0.84, 0.52));
    vec3 H = normalize(L + V);

    float ndotl = max(dot(N, L), 0.0);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    float broadSpec = pow(max(dot(N, H), 0.0), 22.0);
    float crispSpec = pow(max(dot(N, H), 0.0), 120.0);

    vec3 envBounce = vec3(0.75, 0.60, 0.44);
    vec3 col = baseCol * (0.58 + ndotl * 0.85);
    col += envBounce * fresnel * 0.16;
    col += vec3(1.0, 0.90, 0.74) * (broadSpec * 0.12 + crispSpec * 0.52);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const STREAM_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vec3 pos = position;
    // Gentle laminar viscous thinning and subtle flow ripple downward
    float wave = sin(uv.y * 22.0 + uTime * 14.0) * 0.0011;
    pos.x += normal.x * wave;
    pos.z += normal.z * wave;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const STREAM_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorldPos;

  void main() {
    if (uAlpha < 0.02) discard;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(vec3(-0.68, 0.82, 0.46));
    vec3 H = normalize(L + V);

    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.5);
    float spec = pow(max(dot(N, H), 0.0), 64.0);
    float flowBand = 0.5 + 0.5 * sin(vUv.y * 28.0 + uTime * 16.0);

    vec3 core = vec3(0.055, 0.022, 0.010);
    vec3 backlitHoney = vec3(0.46, 0.23, 0.085);
    vec3 col = mix(core, backlitHoney, fresnel * 0.65 + flowBand * 0.10);
    col += vec3(1.0, 0.88, 0.72) * spec * 0.65;

    // Soft fade at very top/bottom endpoints
    float endFade = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    gl_FragColor = vec4(col, uAlpha * endFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function EspressoLiquid({ scrollRef, cremaNoiseTex, pourNonce, reducedMotion }: EspressoLiquidProps) {
  const surfaceRef = useRef<THREE.Mesh>(null);
  const streamRef = useRef<THREE.Mesh>(null);
  const pourElapsedRef = useRef(0);
  const lastNonceRef = useRef(pourNonce);
  // Matches measured inner porcelain cavity of imported espresso-cup.glb (rim at y = 0.630)
  const surfaceRadius = 0.506;

  const surfaceGeom = useMemo(() => createConcentricDiscGeometry(surfaceRadius, 48, 20), []);
  const streamGeom = useMemo(() => new THREE.CylinderGeometry(0.0115, 0.007, 1.08, 20, 28, true), []);

  const surfaceMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ESPRESSO_VERT,
        fragmentShader: ESPRESSO_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uPourIntensity: { value: 0.75 },
          uRadius: { value: surfaceRadius },
          uCremaTex: { value: cremaNoiseTex },
        },
      }),
    [cremaNoiseTex]
  );

  const streamMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: STREAM_VERT,
        fragmentShader: STREAM_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0.92 },
        },
      }),
    []
  );

  useEffect(() => {
    return () => {
      surfaceGeom.dispose();
      streamGeom.dispose();
      surfaceMat.dispose();
      streamMat.dispose();
    };
  }, [surfaceGeom, streamGeom, surfaceMat, streamMat]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    if (lastNonceRef.current !== pourNonce) {
      lastNonceRef.current = pourNonce;
      pourElapsedRef.current = 0;
    }

    const s = scrollRef.current;
    if (!reducedMotion) {
      pourElapsedRef.current += dt;
    }

    const t = reducedMotion ? 1.5 : state.clock.elapsedTime;
    // Active pour in Scene 1 (scroll < 0.24), tapering smoothly as camera pulls away
    const scrollPourFade = 1 - THREE.MathUtils.smoothstep(s, 0.14, 0.28);
    // Initial 6s expressive pour settles down to subtle simmer ripple
    const cyclePulse = reducedMotion ? 0.45 : Math.max(0.28, 1 - THREE.MathUtils.smoothstep(pourElapsedRef.current, 4.5, 8.5));
    const pourIntensity = scrollPourFade * cyclePulse;

    // Cup surface level subtly rises during first 3 seconds of pour to y = 0.545 inside 0.630 porcelain rim
    const fillFrac = reducedMotion ? 1 : THREE.MathUtils.clamp(pourElapsedRef.current / 3.0, 0.25, 1);
    const surfaceY = THREE.MathUtils.lerp(0.445, 0.545, fillFrac);
    const dynamicRadiusScale = THREE.MathUtils.lerp(0.945, 1.0, fillFrac);

    if (surfaceRef.current) {
      surfaceRef.current.position.y = surfaceY;
      surfaceRef.current.scale.set(dynamicRadiusScale, 1, dynamicRadiusScale);
    }

    surfaceMat.uniforms.uTime.value = t;
    surfaceMat.uniforms.uPourIntensity.value = pourIntensity;

    const streamAlpha = scrollPourFade * (reducedMotion ? 0.85 : Math.max(0, 1 - THREE.MathUtils.smoothstep(pourElapsedRef.current, 4.8, 7.2)));
    streamMat.uniforms.uTime.value = t;
    streamMat.uniforms.uAlpha.value = streamAlpha;

    if (streamRef.current) {
      const spoutY = 1.54;
      const streamLen = Math.max(0.1, spoutY - surfaceY);
      streamRef.current.position.y = surfaceY + streamLen * 0.5;
      streamRef.current.scale.set(1, streamLen / 1.08, 1);
      streamRef.current.visible = streamAlpha > 0.02;
    }
  });

  return (
    <group>
      <mesh ref={surfaceRef} geometry={surfaceGeom} material={surfaceMat} position={[0, 0.505, 0]} />
      <mesh ref={streamRef} geometry={streamGeom} material={streamMat} position={[0, 1.19, 0]} />
    </group>
  );
}
