import type { A2UIComponent } from "./a2ui-types";
import { getByPointer, type CatalogRegistry } from "./a2ui-catalog";

interface SurfaceState {
  surfaceId: string;
  catalogId: string;
  components: Map<string, A2UIComponent>;
  dataModel: Record<string, unknown>;
}

class A2UIRenderer {
  private surfaces = new Map<string, SurfaceState>();

  createSurface(surfaceId: string, catalogId: string) {
    this.surfaces.set(surfaceId, {
      surfaceId,
      catalogId,
      components: new Map(),
      dataModel: {},
    });
  }

  updateComponents(surfaceId: string, components: A2UIComponent[]) {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    for (const comp of components) {
      surface.components.set(comp.id, comp);
    }
  }

  updateDataModel(surfaceId: string, path: string | undefined, value: unknown) {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return;
    if (!path || path === "/") {
      surface.dataModel = value as Record<string, unknown>;
    } else {
      setByPointer(surface.dataModel, path, value);
    }
  }

  deleteSurface(surfaceId: string) {
    this.surfaces.delete(surfaceId);
  }

  getSurface(surfaceId: string): SurfaceState | undefined {
    return this.surfaces.get(surfaceId);
  }

  /** Render a surface to a React element tree using the catalog registry */
  renderSurface(
    surfaceId: string,
    registry: CatalogRegistry
  ): React.ReactNode {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return null;

    const catalogRenderers = registry[surface.catalogId];
    if (!catalogRenderers) return null;

    // Find root component
    const root = surface.components.get("root");
    if (!root) return null;

    return this.renderComponent(root, surface, catalogRenderers, registry);
  }

  private renderComponent(
    comp: A2UIComponent,
    surface: SurfaceState,
    catalogRenderers: Record<string, React.ComponentType<import("./a2ui-catalog").A2UIComponentProps>>,
    registry: CatalogRegistry
  ): React.ReactNode {
    const Renderer = catalogRenderers[comp.component];
    if (!Renderer) return null;

    const children: React.ReactNode[] = [];

    // Resolve children references
    if (comp.children && Array.isArray(comp.children)) {
      for (const childId of comp.children) {
        const childComp = surface.components.get(childId);
        if (childComp) {
          children.push(
            this.renderComponent(childComp, surface, catalogRenderers, registry)
          );
        }
      }
    }

    if (comp.child) {
      const childComp = surface.components.get(comp.child);
      if (childComp) {
        children.push(
          this.renderComponent(childComp, surface, catalogRenderers, registry)
        );
      }
    }

    // Resolve bound properties
    const props: Record<string, unknown> = {
      id: comp.id,
      component: comp.component,
      dataModel: surface.dataModel,
    };

    for (const [key, value] of Object.entries(comp)) {
      if (key === "id" || key === "component" || key === "children" || key === "child") continue;
      if (value && typeof value === "object" && "path" in (value as object)) {
        props[key] = getByPointer(surface.dataModel, (value as { path: string }).path);
      } else {
        props[key] = value;
      }
    }

    if (children.length > 0) {
      return <Renderer key={comp.id} {...props}>{children}</Renderer>;
    }
    return <Renderer key={comp.id} {...props} />;
  }
}

/** Set a value at a JSON Pointer path in an object */
function setByPointer(obj: Record<string, unknown>, pointer: string, value: unknown) {
  const parts = pointer.split("/").filter(Boolean);
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export const a2uiRenderer = new A2UIRenderer();
