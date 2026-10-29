// The WebGL stage (lazy-loaded by Stage.tsx). Decision D3: it shows the viewer's own steps as extruded blocks in a
// row (done = gold, current = orange and raised, later = graphite), never the logo. Demand frameloop: frames are
// requested at ~30fps only while `running`.
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { StageStep } from "./Stage";
import { BLOCK_D, BLOCK_H, BLOCK_W, FRAME_H, GAP, frameWidth } from "./layout";

const COLOR: Record<StageStep["state"], string> = { done: "#FFC629", current: "#FF5A0F", todo: "#2B3550" };

/** A block with bevelled edges (an extruded rounded rectangle), centred on the origin. */
function blockGeometry() {
  const r = 0.06, w = BLOCK_W, h = BLOCK_H;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: BLOCK_D, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -BLOCK_D / 2);
  return g;
}

/** Fit the row of blocks inside the frame whatever its aspect ratio. */
function Fit({ count }: { count: number }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const w = frameWidth(count), h = FRAME_H;
    const vfov = (cam.fov * Math.PI) / 180;
    const aspect = size.width / Math.max(1, size.height);
    cam.position.z = Math.max(h / 2 / Math.tan(vfov / 2), w / 2 / Math.tan(vfov / 2) / aspect);
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, count, invalidate]);
  return null;
}

function Rig({ running }: { running: boolean }) {
  const { invalidate } = useThree();
  useEffect(() => {
    if (!running) return;
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) { last = t; invalidate(); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, invalidate]);
  return null;
}

function Blocks({ steps }: { steps: StageStep[] }) {
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(blockGeometry, []);
  const mats = useMemo(() => steps.map((s) => new THREE.MeshStandardMaterial({
    color: COLOR[s.state], roughness: s.state === "todo" ? 0.8 : 0.45, metalness: 0.05,
    emissive: COLOR[s.state], emissiveIntensity: s.state === "current" ? 0.22 : s.state === "done" ? 0.08 : 0,
  })), [steps]);
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const grown = useRef(0);
  useEffect(() => () => { geometry.dispose(); mats.forEach((m) => m.dispose()); }, [geometry, mats]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      group.current.rotation.x = -0.32 + state.pointer.y * 0.05;
      group.current.rotation.y = Math.sin(t * 0.3) * 0.12 + state.pointer.x * 0.1;
    }
    if (grown.current < 1) grown.current = Math.min(1, grown.current + delta * 1.4);
    const k = 1 - Math.pow(1 - grown.current, 3);
    steps.forEach((s, i) => {
      const m = refs.current[i];
      if (!m) return;
      const lift = s.state === "current" ? 0.18 + Math.sin(t * 1.4) * 0.03 : 0;
      m.position.y = lift * k;
      m.scale.y = (s.state === "current" ? 1.25 : 1) * Math.max(0.05, k);
    });
  });

  const x0 = -((steps.length - 1) * (BLOCK_W + GAP)) / 2;
  return (
    <group ref={group}>
      {steps.map((_, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={geometry} material={mats[i]} position={[x0 + i * (BLOCK_W + GAP), 0, 0]} />
      ))}
    </group>
  );
}

export default function StageScene({ steps, running }: { steps: StageStep[]; running: boolean }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "low-power", alpha: true }}
            camera={{ position: [0, 0.4, 6], fov: 32 }} aria-hidden>
      <ambientLight intensity={0.55} />
      <directionalLight position={[-3, 5, 4]} intensity={1.4} color="#F4F6FA" />
      <directionalLight position={[3, 1, -3]} intensity={0.6} color="#4D8BFF" />
      <Blocks steps={steps} />
      <Fit count={steps.length} />
      <Rig running={running} />
    </Canvas>
  );
}
