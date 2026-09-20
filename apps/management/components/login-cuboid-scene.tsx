'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  readThemeColors,
  usePrefersReducedMotion,
  useThemeSignal,
} from './three-theme-utils';
import { env } from '@campuspilot/env/management.client';

/** Tuning panel is a dev aid only — it never ships to production builds. */
const DEV_CONTROLS_ENABLED = env.NEXT_PUBLIC_ENABLE_THREEJS_CONTROLS;

export type CuboidSceneSettings = {
  columns: number;
  rows: number;
  pitch: number;
  cellSize: number;
  baseHeight: number;
  waveHeight: number;
  waveSpeed: number;
  hoverHeight: number;
  hoverRadius: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  fov: number;
  transmission: number;
  thickness: number;
  roughness: number;
  metalness: number;
  ior: number;
  opacity: number;
  envIntensity: number;
  iridescence: number;
  iridescenceIOR: number;
  iridescenceThicknessMin: number;
  iridescenceThicknessMax: number;
  rimEnabled: boolean;
  rimInset: number;
  rimThickness: number;
  rimIntensity: number;
};

/** The finalized, reviewed look for the glass/iridescent cuboid grid. */
export const DEFAULT_CUBOID_SCENE_SETTINGS: CuboidSceneSettings = {
  columns: 24,
  rows: 21,
  pitch: 1.54,
  cellSize: 1.36,
  baseHeight: 0.12,
  waveHeight: 1.19,
  waveSpeed: 0.75,
  hoverHeight: 0.36,
  hoverRadius: 2.4,
  rotationX: 3,
  rotationY: 0,
  rotationZ: 0,
  cameraX: 4.9,
  cameraY: 7.9,
  cameraZ: 10.5,
  fov: 38,
  transmission: 1,
  thickness: 0.99,
  roughness: 0.22,
  metalness: 1,
  ior: 2.4,
  opacity: 0.79,
  envIntensity: 3,
  iridescence: 1,
  iridescenceIOR: 1.76,
  iridescenceThicknessMin: 800,
  iridescenceThicknessMax: 1200,
  rimEnabled: true,
  rimInset: 0.09,
  rimThickness: 0.01,
  rimIntensity: 4,
};

type SliderDef = {
  key: keyof CuboidSceneSettings;
  label: string;
  min: number;
  max: number;
  step: number;
};

const GRID_SLIDERS: SliderDef[] = [
  { key: 'columns', label: 'Columns', min: 4, max: 40, step: 1 },
  { key: 'rows', label: 'Rows', min: 4, max: 40, step: 1 },
  { key: 'pitch', label: 'Spacing', min: 0.4, max: 2, step: 0.01 },
  { key: 'cellSize', label: 'Cell size', min: 0.1, max: 2, step: 0.01 },
  { key: 'baseHeight', label: 'Base height', min: 0, max: 0.5, step: 0.01 },
  { key: 'waveHeight', label: 'Wave height', min: 0, max: 2, step: 0.01 },
  { key: 'waveSpeed', label: 'Wave speed', min: 0, max: 3, step: 0.05 },
  { key: 'hoverHeight', label: 'Hover lift', min: 0, max: 2, step: 0.01 },
  { key: 'hoverRadius', label: 'Hover radius', min: 0.5, max: 6, step: 0.1 },
];

const CAMERA_SLIDERS: SliderDef[] = [
  { key: 'rotationX', label: 'Rotate X', min: -180, max: 180, step: 1 },
  { key: 'rotationY', label: 'Rotate Y', min: -180, max: 180, step: 1 },
  { key: 'rotationZ', label: 'Rotate Z', min: -180, max: 180, step: 1 },
  { key: 'cameraX', label: 'Camera X', min: -15, max: 15, step: 0.1 },
  { key: 'cameraY', label: 'Camera Y', min: 0.5, max: 20, step: 0.1 },
  { key: 'cameraZ', label: 'Camera Z', min: 1, max: 25, step: 0.1 },
  { key: 'fov', label: 'Field of view', min: 15, max: 75, step: 1 },
];

const MATERIAL_SLIDERS: SliderDef[] = [
  { key: 'transmission', label: 'Transmission', min: 0, max: 1, step: 0.01 },
  { key: 'thickness', label: 'Thickness', min: 0, max: 3, step: 0.01 },
  { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
  { key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 },
  { key: 'ior', label: 'IOR', min: 1, max: 2.4, step: 0.01 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01 },
  { key: 'envIntensity', label: 'Env intensity', min: 0, max: 3, step: 0.05 },
  { key: 'iridescence', label: 'Iridescence', min: 0, max: 1, step: 0.01 },
  {
    key: 'iridescenceIOR',
    label: 'Iridescence IOR',
    min: 1,
    max: 2.4,
    step: 0.01,
  },
  {
    key: 'iridescenceThicknessMin',
    label: 'Iridescence thickness min',
    min: 0,
    max: 800,
    step: 5,
  },
  {
    key: 'iridescenceThicknessMax',
    label: 'Iridescence thickness max',
    min: 0,
    max: 1200,
    step: 5,
  },
];

const RIM_SLIDERS: SliderDef[] = [
  { key: 'rimInset', label: 'Rim inset', min: 0, max: 0.3, step: 0.005 },
  {
    key: 'rimThickness',
    label: 'Rim thickness',
    min: 0.01,
    max: 0.3,
    step: 0.005,
  },
  { key: 'rimIntensity', label: 'Rim intensity', min: 0, max: 4, step: 0.05 },
];

function formatValue(step: number, value: number): string {
  return step >= 1
    ? String(Math.round(value))
    : value.toFixed(step < 0.01 ? 3 : 2);
}

function SliderRow({
  def,
  value,
  onChange,
}: {
  def: SliderDef;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] font-medium">
        <label htmlFor={def.key}>{def.label}</label>
        <output htmlFor={def.key} className="font-mono text-muted-foreground">
          {formatValue(def.step, value)}
        </output>
      </div>
      <input
        id={def.key}
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        className="h-1.5 w-full cursor-pointer accent-primary"
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

function ControlGroup({
  title,
  sliders,
  settings,
  onChange,
  defaultOpen = false,
}: {
  title: string;
  sliders: SliderDef[];
  settings: CuboidSceneSettings;
  onChange: (key: keyof CuboidSceneSettings, value: number) => void;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="cursor-pointer list-none py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </summary>
      <div className="flex flex-col gap-3 py-2">
        {sliders.map((def) => (
          <SliderRow
            key={def.key}
            def={def}
            value={settings[def.key] as number}
            onChange={(value) => onChange(def.key, value)}
          />
        ))}
      </div>
    </details>
  );
}

function CuboidControlsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: CuboidSceneSettings;
  onChange: (key: keyof CuboidSceneSettings, value: number | boolean) => void;
  onReset: () => void;
}) {
  const [copyLabel, setCopyLabel] = useState('Copy');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
      setCopyLabel('Copied');
    } catch {
      setCopyLabel('Failed');
    }
    setTimeout(() => setCopyLabel('Copy'), 1500);
  }

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 flex max-h-[85vh] w-72 flex-col overflow-y-auto rounded-2xl border border-border bg-background/90 p-4 text-foreground shadow-lg backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Dev controls
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {copyLabel}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
      </div>
      <ControlGroup
        title="Grid"
        sliders={GRID_SLIDERS}
        settings={settings}
        onChange={onChange}
        defaultOpen
      />
      <ControlGroup
        title="Rotation & camera"
        sliders={CAMERA_SLIDERS}
        settings={settings}
        onChange={onChange}
      />
      <ControlGroup
        title="Material"
        sliders={MATERIAL_SLIDERS}
        settings={settings}
        onChange={onChange}
      />
      <details className="group">
        <summary className="cursor-pointer list-none py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Edge rim
        </summary>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex items-center justify-between gap-3 text-[11px] font-medium">
            Enabled
            <input
              type="checkbox"
              checked={settings.rimEnabled}
              onChange={(event) =>
                onChange('rimEnabled', event.currentTarget.checked)
              }
              className="accent-primary"
            />
          </label>
          {RIM_SLIDERS.map((def) => (
            <SliderRow
              key={def.key}
              def={def}
              value={settings[def.key] as number}
              onChange={(value) => onChange(def.key, value)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function createRimTexture(
  inset: number,
  thickness: number,
): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const marginPx = inset * size;
  const linePx = Math.max(1, thickness * size);
  context.strokeStyle = '#ffffff';
  context.lineWidth = linePx;
  context.strokeRect(
    marginPx,
    marginPx,
    size - marginPx * 2,
    size - marginPx * 2,
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Scales a base color's brightness for the additive rim glow while holding
 * hue and saturation fixed — a naive RGB-scalar multiply clips channels
 * unevenly and drifts an orange rim toward yellow/white at high intensity.
 */
function applyRimIntensity(
  target: THREE.Color,
  base: THREE.Color,
  intensity: number,
): void {
  const hsl = { h: 0, s: 0, l: 0 };
  base.getHSL(hsl);
  // Only lightness moves — hue/saturation stay locked to the base color so the
  // glow never drifts toward yellow/white the way a raw per-channel RGB
  // multiply does once R and G individually clip.
  const lightness = THREE.MathUtils.clamp(
    hsl.l * Math.max(0.001, intensity),
    0.02,
    0.55,
  );
  target.setHSL(hsl.h, hsl.s, lightness);
}

type CellState = { wave: number; hover: number };

export function LoginCuboidScene({
  settings,
}: { settings?: Partial<CuboidSceneSettings> } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const themeSignal = useThemeSignal();
  const reducedMotion = usePrefersReducedMotion();
  const initialSettingsRef = useRef<CuboidSceneSettings>({
    ...DEFAULT_CUBOID_SCENE_SETTINGS,
    ...settings,
  });
  const [controls, setControls] = useState<CuboidSceneSettings>(
    initialSettingsRef.current,
  );
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const cameraObjectRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupObjectRef = useRef<THREE.Group | null>(null);
  const boxMaterialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const rimMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const rimMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const rimTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const rimBaseColorRef = useRef<THREE.Color | null>(null);

  const { columns, rows } = controls;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = readThemeColors({
      cell: '--muted',
      cellHigh: '--foreground',
      light: '--primary-foreground',
      rim: '--primary',
    });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      controlsRef.current.fov,
      1,
      0.1,
      100,
    );
    camera.position.set(
      controlsRef.current.cameraX,
      controlsRef.current.cameraY,
      controlsRef.current.cameraZ,
    );
    camera.lookAt(0, 0.3, 0);
    cameraObjectRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    let environmentTexture: THREE.Texture | null = null;
    try {
      environmentTexture = pmremGenerator.fromScene(
        new RoomEnvironment(),
        0.04,
      ).texture;
      scene.environment = environmentTexture;
    } catch (error) {
      console.error('[LoginCuboidScene] environment generation failed', error);
    }

    scene.add(new THREE.AmbientLight(colors.light, 0.4));
    const keyLight = new THREE.DirectionalLight(colors.light, 1.1);
    keyLight.position.set(5, 9, 4);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(colors.cellHigh, 0.3);
    rimLight.position.set(-6, 3, -4);
    scene.add(rimLight);

    const group = new THREE.Group();
    group.rotation.set(
      THREE.MathUtils.degToRad(controlsRef.current.rotationX),
      THREE.MathUtils.degToRad(controlsRef.current.rotationY),
      THREE.MathUtils.degToRad(controlsRef.current.rotationZ),
    );
    scene.add(group);
    groupObjectRef.current = group;

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: colors.cell }),
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.6;
    group.add(backdrop);

    const cellCount = columns * rows;
    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    boxGeometry.translate(0, 0.5, 0);
    const boxMaterial = new THREE.MeshPhysicalMaterial({
      color: colors.cell,
      roughness: controlsRef.current.roughness,
      metalness: controlsRef.current.metalness,
      transmission: controlsRef.current.transmission,
      thickness: controlsRef.current.thickness,
      ior: controlsRef.current.ior,
      opacity: controlsRef.current.opacity,
      transparent: controlsRef.current.opacity < 1,
      envMapIntensity: controlsRef.current.envIntensity,
      iridescence: controlsRef.current.iridescence,
      iridescenceIOR: controlsRef.current.iridescenceIOR,
      iridescenceThicknessRange: [
        controlsRef.current.iridescenceThicknessMin,
        controlsRef.current.iridescenceThicknessMax,
      ],
    });
    boxMaterialRef.current = boxMaterial;
    const mesh = new THREE.InstancedMesh(boxGeometry, boxMaterial, cellCount);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(cellCount * 3),
      3,
    );
    group.add(mesh);

    const rimTexture = createRimTexture(
      controlsRef.current.rimInset,
      controlsRef.current.rimThickness,
    );
    rimTextureRef.current = rimTexture;
    const rimGeometry = new THREE.PlaneGeometry(1, 1);
    rimGeometry.rotateX(-Math.PI / 2);
    rimBaseColorRef.current = colors.rim.clone();
    const rimColor = new THREE.Color();
    applyRimIntensity(rimColor, colors.rim, controlsRef.current.rimIntensity);
    const rimMaterial = new THREE.MeshBasicMaterial({
      map: rimTexture,
      color: rimColor,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      visible: controlsRef.current.rimEnabled,
    });
    rimMaterialRef.current = rimMaterial;
    const rimMesh = new THREE.InstancedMesh(
      rimGeometry,
      rimMaterial,
      cellCount,
    );
    rimMeshRef.current = rimMesh;
    group.add(rimMesh);

    const cellStates: CellState[] = Array.from({ length: cellCount }, () => ({
      wave: 0,
      hover: 0,
    }));
    const dummy = new THREE.Object3D();
    const tintColor = new THREE.Color();

    const pointer = new THREE.Vector2(-10, -10);
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pointerTarget = new THREE.Vector3();

    function handlePointerMove(event: PointerEvent) {
      const rect = container!.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }
    function handlePointerLeave() {
      pointer.set(-10, -10);
    }
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);

    function resize() {
      const { clientWidth, clientHeight } = container!;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frameId = 0;
    const clock = new THREE.Clock();

    function renderFrame() {
      const params = controlsRef.current;
      const elapsed = reducedMotion ? 0 : clock.getElapsedTime();

      raycaster.setFromCamera(pointer, camera);
      const hasHover =
        raycaster.ray.intersectPlane(groundPlane, pointerTarget) !== null;

      const originX = ((columns - 1) * params.pitch) / 2;
      const originZ = ((rows - 1) * params.pitch) / 2;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const x = column * params.pitch - originX;
          const z = row * params.pitch - originZ;

          const wavePhase = elapsed * params.waveSpeed - (column + row) * 0.32;
          const waveTarget = reducedMotion
            ? 0
            : Math.max(0, Math.sin(wavePhase)) * params.waveHeight;

          let hoverTarget = 0;
          if (hasHover) {
            const distance = Math.hypot(
              x - pointerTarget.x,
              z - pointerTarget.z,
            );
            hoverTarget =
              Math.max(0, 1 - distance / params.hoverRadius) ** 2 *
              params.hoverHeight;
          }

          const state = cellStates[index]!;
          state.wave += (waveTarget - state.wave) * 0.12;
          state.hover += (hoverTarget - state.hover) * 0.18;

          const height = params.baseHeight + state.wave + state.hover;

          dummy.position.set(x, 0, z);
          dummy.scale.set(params.cellSize, height, params.cellSize);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);

          dummy.position.set(x, height + 0.002, z);
          dummy.scale.set(params.cellSize, 1, params.cellSize);
          dummy.updateMatrix();
          rimMesh.setMatrixAt(index, dummy.matrix);

          const lift = Math.min(
            1,
            (state.wave + state.hover) / (params.waveHeight * 0.6 + 0.001),
          );
          tintColor.copy(colors.cell).lerp(colors.cellHigh, lift * 0.55);
          mesh.setColorAt(index, tintColor);
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      rimMesh.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(renderFrame);
    }
    renderFrame();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      boxGeometry.dispose();
      boxMaterial.dispose();
      rimGeometry.dispose();
      rimMaterial.dispose();
      rimTexture.dispose();
      backdrop.geometry.dispose();
      (backdrop.material as THREE.Material).dispose();
      environmentTexture?.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [themeSignal, reducedMotion, columns, rows]);

  useEffect(() => {
    const camera = cameraObjectRef.current;
    if (!camera) return;
    camera.position.set(controls.cameraX, controls.cameraY, controls.cameraZ);
    camera.fov = controls.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0.3, 0);
  }, [controls.cameraX, controls.cameraY, controls.cameraZ, controls.fov]);

  useEffect(() => {
    const group = groupObjectRef.current;
    if (!group) return;
    group.rotation.set(
      THREE.MathUtils.degToRad(controls.rotationX),
      THREE.MathUtils.degToRad(controls.rotationY),
      THREE.MathUtils.degToRad(controls.rotationZ),
    );
  }, [controls.rotationX, controls.rotationY, controls.rotationZ]);

  useEffect(() => {
    const material = boxMaterialRef.current;
    if (!material) return;
    material.transmission = controls.transmission;
    material.thickness = controls.thickness;
    material.roughness = controls.roughness;
    material.metalness = controls.metalness;
    material.ior = controls.ior;
    material.opacity = controls.opacity;
    material.transparent = controls.opacity < 1;
    material.envMapIntensity = controls.envIntensity;
    material.iridescence = controls.iridescence;
    material.iridescenceIOR = controls.iridescenceIOR;
    material.iridescenceThicknessRange = [
      controls.iridescenceThicknessMin,
      controls.iridescenceThicknessMax,
    ];
    material.needsUpdate = true;
  }, [
    controls.transmission,
    controls.thickness,
    controls.roughness,
    controls.metalness,
    controls.ior,
    controls.opacity,
    controls.envIntensity,
    controls.iridescence,
    controls.iridescenceIOR,
    controls.iridescenceThicknessMin,
    controls.iridescenceThicknessMax,
  ]);

  useEffect(() => {
    const rimMesh = rimMeshRef.current;
    const rimMaterial = rimMaterialRef.current;
    const baseColor = rimBaseColorRef.current;
    if (rimMesh) rimMesh.visible = controls.rimEnabled;
    if (rimMaterial && baseColor) {
      applyRimIntensity(rimMaterial.color, baseColor, controls.rimIntensity);
    }
  }, [controls.rimEnabled, controls.rimIntensity]);

  useEffect(() => {
    const rimMaterial = rimMaterialRef.current;
    if (!rimMaterial) return;
    const nextTexture = createRimTexture(
      controls.rimInset,
      controls.rimThickness,
    );
    rimMaterial.map = nextTexture;
    rimMaterial.needsUpdate = true;
    rimTextureRef.current?.dispose();
    rimTextureRef.current = nextTexture;
  }, [controls.rimInset, controls.rimThickness]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" aria-hidden="true" />
      {DEV_CONTROLS_ENABLED && (
        <CuboidControlsPanel
          settings={controls}
          onChange={(key, value) =>
            setControls((previous) => ({ ...previous, [key]: value }))
          }
          onReset={() => setControls(initialSettingsRef.current)}
        />
      )}
    </>
  );
}
