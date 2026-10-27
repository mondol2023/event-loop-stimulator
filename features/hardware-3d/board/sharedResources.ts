import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, ExtrudeGeometry, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Shape } from "three";
import { acquire, release } from "./boardResources";
import type { BoardTheme, ColorToken } from "./boardColors";

// Geometries and materials are shared across the board's meshes through boardResources, and disposed when the last user unmounts.
// R3F's own reconciler root does not run StrictMode, so one acquire per mount pairs with one release per unmount.

export type ShapeKind = "box" | "plane" | "alu" | "arrow";

function createGeometry(kind: ShapeKind): BufferGeometry {
  switch (kind) {
    case "box":
      return new BoxGeometry(1, 1, 1);
    case "plane":
      return new PlaneGeometry(1, 1);
    case "alu": {
      // A raised trapezoid, narrower at the top, 1 x 1 so a mesh scales it to its rectangle.
      const shape = new Shape();
      shape.moveTo(-0.5, -0.5);
      shape.lineTo(0.5, -0.5);
      shape.lineTo(0.36, 0.5);
      shape.lineTo(-0.36, 0.5);
      shape.closePath();
      return new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    }
    case "arrow": {
      // An arrowhead pointing along +x, centred on the origin.
      const shape = new Shape();
      shape.moveTo(0.5, 0);
      shape.lineTo(-0.5, 0.5);
      shape.lineTo(-0.5, -0.5);
      shape.closePath();
      return new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    }
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export function useShapeGeometry(kind: ShapeKind): BufferGeometry {
  const key = `geometry:${kind}`;
  const geometry = useMemo(() => acquire(key, () => createGeometry(kind)), [key, kind]);
  useEffect(() => () => release(key), [key]);
  return geometry;
}

export type MaterialKind = "lit" | "basic";

/** A material in a design token's colour: `lit` takes the scene lights, `basic` does not. It follows the theme. */
export function useTokenMaterial(theme: BoardTheme, token: ColorToken, kind: MaterialKind): MeshLambertMaterial | MeshBasicMaterial {
  const key = `material:${kind}:${token}`;
  const material = useMemo(
    () => acquire(key, () => (kind === "lit" ? new MeshLambertMaterial({ color: theme.colors[token] }) : new MeshBasicMaterial({ color: theme.colors[token] }))),
    [key, kind, theme, token],
  );
  useEffect(() => {
    const off = theme.subscribe(() => material.color.copy(theme.colors[token]));
    return () => {
      off();
      release(key);
    };
  }, [key, material, theme, token]);
  return material;
}

const WHITE_KEY = "material:lit:white";

/** A white lit material for instanced meshes, whose per-instance colours do the painting. */
export function useWhiteMaterial(): MeshLambertMaterial {
  const material = useMemo(() => acquire(WHITE_KEY, () => new MeshLambertMaterial({ color: 0xffffff })), []);
  useEffect(() => () => release(WHITE_KEY), []);
  return material;
}
