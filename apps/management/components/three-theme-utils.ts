'use client';

import { useEffect, useState } from 'react';
import * as THREE from 'three';

let sharedCanvas: HTMLCanvasElement | null = null;

/**
 * Resolves any CSS color (oklch, color-mix, hex, ...) to a THREE.Color by
 * letting the browser's canvas 2D context do the parsing/conversion.
 */
function cssColorToThree(cssColor: string): THREE.Color {
  const canvas = sharedCanvas ?? (sharedCanvas = document.createElement('canvas'));
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) return new THREE.Color('#888888');
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(r / 255, g / 255, b / 255);
}

function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function readThemeColor(name: string): THREE.Color {
  return cssColorToThree(readCssVar(name));
}

export function readThemeColors<K extends string>(
  names: Record<K, string>,
): Record<K, THREE.Color> {
  const entries = Object.entries(names) as Array<[K, string]>;
  return Object.fromEntries(
    entries.map(([key, cssVar]) => [key, readThemeColor(cssVar)]),
  ) as Record<K, THREE.Color>;
}

/**
 * Re-runs `getColors` whenever the `.dark` class on <html> toggles, so a
 * three.js scene can react to the theme switch without a page reload.
 */
export function useThemeSignal(): number {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setSignal((value) => value + 1));
    observer.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return signal;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return reduced;
}
