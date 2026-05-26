import type { ComponentType } from "react";
import type { A2UIComponent } from "./a2ui-types";

export const WEATHER_CATALOG_ID =
  "https://weather-assistant.local/a2ui/catalogs/weather/v1";

export interface A2UIComponentProps {
  id?: string;
  component?: string;
  children?: React.ReactNode;
  child?: React.ReactNode;
  dataModel?: Record<string, unknown>;
  [key: string]: unknown;
}

export type CatalogRegistry = Record<
  string,
  Record<string, ComponentType<A2UIComponentProps>>
>;

export function resolveBinding(
  value: unknown,
  dataModel: Record<string, unknown>
): unknown {
  if (value && typeof value === "object" && "path" in value) {
    return getByPointer(dataModel, (value as { path: string }).path);
  }
  return value;
}

export function getByPointer(
  obj: Record<string, unknown>,
  pointer: string
): unknown {
  if (!pointer || pointer === "/") return obj;
  const parts = pointer.split("/").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
