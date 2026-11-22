import * as THREE from "three";

/**
 * Scale: 1 Three.js unit = 10 cm.
 * Espresso cup: ~7.8 cm outer rim diameter, ~6.7 cm tall.
 * Saucer: ~13.8 cm diameter, resting flush on tabletop y = 0.
 * Coffee bean: ~1.18 cm x 0.84 cm x 0.54 cm.
 */

export function createSaucerGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.012),
    new THREE.Vector2(0.18, 0.012),
    new THREE.Vector2(0.24, 0.004),
    new THREE.Vector2(0.32, 0.002), // rests flush on table
    new THREE.Vector2(0.46, 0.025),
    new THREE.Vector2(0.62, 0.068),
    new THREE.Vector2(0.675, 0.092),
    new THREE.Vector2(0.688, 0.104), // soft rolled rim
    new THREE.Vector2(0.676, 0.114),
    new THREE.Vector2(0.652, 0.108),
    new THREE.Vector2(0.48, 0.056),
    new THREE.Vector2(0.29, 0.032), // recessed cup well rim
    new THREE.Vector2(0.24, 0.028),
    new THREE.Vector2(0.0, 0.028),
  ];
  const geom = new THREE.LatheGeometry(pts, 72);
  geom.computeVertexNormals();
  return geom;
}

export function createCupFootGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.18, 0.028),
    new THREE.Vector2(0.214, 0.028),
    new THREE.Vector2(0.218, 0.062),
    new THREE.Vector2(0.19, 0.062),
    new THREE.Vector2(0.18, 0.028),
  ];
  const geom = new THREE.LatheGeometry(pts, 72);
  geom.computeVertexNormals();
  return geom;
}

export function createCupExteriorGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.228, 0.058),
    new THREE.Vector2(0.268, 0.095),
    new THREE.Vector2(0.312, 0.195),
    new THREE.Vector2(0.348, 0.34),
    new THREE.Vector2(0.372, 0.49),
    new THREE.Vector2(0.388, 0.62),
    new THREE.Vector2(0.392, 0.652),
    new THREE.Vector2(0.382, 0.672), // tactile thick ceramic lip
    new THREE.Vector2(0.362, 0.672),
    new THREE.Vector2(0.352, 0.656),
    new THREE.Vector2(0.348, 0.61),
  ];
  const geom = new THREE.LatheGeometry(pts, 72);
  geom.computeVertexNormals();
  return geom;
}

export function createCupInteriorGeometry(): THREE.LatheGeometry {
  // Ordered top-to-bottom so LatheGeometry normals face INWARD & UPWARD into the cup bowl.
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.364, 0.671),
    new THREE.Vector2(0.354, 0.658),
    new THREE.Vector2(0.348, 0.61),
    new THREE.Vector2(0.328, 0.51),
    new THREE.Vector2(0.285, 0.34),
    new THREE.Vector2(0.225, 0.21),
    new THREE.Vector2(0.14, 0.155),
    new THREE.Vector2(0.0, 0.145),
  ];
  const geom = new THREE.LatheGeometry(pts, 72);
  geom.computeVertexNormals();
  return geom;
}

export function createCupHandleGeometry(): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.345, 0.555, 0),
    new THREE.Vector3(0.465, 0.568, 0),
    new THREE.Vector3(0.545, 0.485, 0),
    new THREE.Vector3(0.532, 0.355, 0),
    new THREE.Vector3(0.445, 0.245, 0),
    new THREE.Vector3(0.305, 0.215, 0),
  ]);
  const geom = new THREE.TubeGeometry(curve, 36, 0.036, 16, false);
  // Subtle ergonomic flattening along Z so the ear handle feels handmade
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) * 1.25);
  }
  geom.computeVertexNormals();
  return geom;
}

/**
 * Anatomically sculpted roasted Arabica coffee bean (~1.18 cm long).
 * Flat side faces -Y with an S-curved ventral cleft; rounded back faces +Y.
 */
export function createCoffeeBeanGeometry(): THREE.BufferGeometry {
  const geom = new THREE.SphereGeometry(1, 22, 16);
  const pos = geom.attributes.position;
  const uv = geom.attributes.uv;

  const halfW = 0.048;
  const halfH = 0.032;
  const halfL = 0.066;

  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);

    // Taper smoothly toward bean poles
    const zScale = 1 - 0.14 * Math.pow(Math.abs(sz), 2.2);
    let x = sx * halfW * zScale;
    let y = sy > 0 ? sy * halfH * 1.05 : sy * halfH * 0.42;
    const z = sz * halfL;

    // Slight S-curve ventral crease on flat underside (sy < 0.12)
    const sCurve = Math.sin(sz * 2.5) * 0.0055;
    if (sy < 0.15) {
      const distFromCrease = Math.abs(x - sCurve);
      const grooveMask = Math.exp(-Math.pow(distFromCrease / 0.0085, 2.0));
      const flatFactor = Math.min(1, Math.max(0, (0.15 - sy) / 0.75));
      y += grooveMask * flatFactor * 0.0145;
      // Subtle rounded lips flanking the crease
      const lipMask = Math.exp(-Math.pow((distFromCrease - 0.011) / 0.007, 2.0));
      y -= lipMask * flatFactor * 0.003;
    }

    pos.setXYZ(i, x, y, z);

    // Map UV.x around 0.5 inside the crease for realistic chaff tinting
    const creaseU = 0.5 + ((x - sCurve) / (halfW * 2)) * (sy < 0.1 ? 1.0 : 0.35);
    uv.setXY(i, Math.min(0.98, Math.max(0.02, creaseU)), 0.5 + sz * 0.45);
  }

  geom.computeVertexNormals();
  return geom;
}

/**
 * Refined brushed espresso portafilter spout suspended cleanly above the hero cup.
 */
export function createPortafilterSpoutGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.022, 0.0),
    new THREE.Vector2(0.024, 0.025),
    new THREE.Vector2(0.042, 0.06),
    new THREE.Vector2(0.095, 0.11),
    new THREE.Vector2(0.14, 0.15),
    new THREE.Vector2(0.145, 0.24),
    new THREE.Vector2(0.0, 0.24),
  ];
  const geom = new THREE.LatheGeometry(pts, 36);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Barista milk steaming pitcher for Scene 3 ("From Bean to Cup").
 */
export function createMilkPitcherGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.24, 0.0),
    new THREE.Vector2(0.25, 0.03),
    new THREE.Vector2(0.23, 0.25),
    new THREE.Vector2(0.195, 0.46),
    new THREE.Vector2(0.21, 0.51),
    new THREE.Vector2(0.196, 0.515),
    new THREE.Vector2(0.182, 0.46),
    new THREE.Vector2(0.212, 0.24),
    new THREE.Vector2(0.225, 0.025),
    new THREE.Vector2(0.0, 0.025),
  ];
  const geom = new THREE.LatheGeometry(pts, 48);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Glass cold-brew / filter coffee carafe for Scene 3 ("From Bean to Cup").
 */
export function createCarafeGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.22, 0.0),
    new THREE.Vector2(0.26, 0.05),
    new THREE.Vector2(0.28, 0.18),
    new THREE.Vector2(0.21, 0.38),
    new THREE.Vector2(0.145, 0.52),
    new THREE.Vector2(0.155, 0.62),
    new THREE.Vector2(0.168, 0.65),
    new THREE.Vector2(0.156, 0.655),
    new THREE.Vector2(0.135, 0.52),
    new THREE.Vector2(0.195, 0.37),
    new THREE.Vector2(0.262, 0.18),
    new THREE.Vector2(0.245, 0.055),
    new THREE.Vector2(0.20, 0.02),
    new THREE.Vector2(0.0, 0.02),
  ];
  const geom = new THREE.LatheGeometry(pts, 48);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Shallow stoneware tasting dish for roasted beans in Scene 3.
 */
export function createTastingDishGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.20, 0.0),
    new THREE.Vector2(0.27, 0.03),
    new THREE.Vector2(0.31, 0.085),
    new THREE.Vector2(0.318, 0.102),
    new THREE.Vector2(0.298, 0.106),
    new THREE.Vector2(0.25, 0.048),
    new THREE.Vector2(0.17, 0.022),
    new THREE.Vector2(0.0, 0.022),
  ];
  const geom = new THREE.LatheGeometry(pts, 48);
  geom.computeVertexNormals();
  return geom;
}
