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

  /** Check if a surface contains a component with the given name */
  hasComponent(surfaceId: string, componentName: string): boolean {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return false;
    for (const comp of surface.components.values()) {
      if (comp.component === componentName) return true;
    }
    return false;
  }

  /** Render a surface but skip components with the given name. Returns [mainContent, skippedComponents[]] */
  renderSurfaceSplit(
    surfaceId: string,
    registry: CatalogRegistry,
    skipComponent?: string
  ): [React.ReactNode, React.ReactNode[]] {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return [null, []];

    const catalogRenderers = registry[surface.catalogId];
    if (!catalogRenderers) return [null, []];

    const root = surface.components.get("root");
    if (!root) return [null, []];

    if (!skipComponent) {
      return [this.renderComponent(root, surface, catalogRenderers, registry), []];
    }

    // Collect skipped component IDs
    const skippedIds = new Set<string>();
    for (const [id, comp] of surface.components) {
      if (comp.component === skipComponent) {
        skippedIds.add(id);
      }
    }

    // Render main content (root with skipped children removed)
    const mainContent = this.renderComponentFiltered(root, surface, catalogRenderers, registry, skippedIds);

    // Render skipped components separately
    const skippedNodes: React.ReactNode[] = [];
    for (const id of skippedIds) {
      const comp = surface.components.get(id);
      if (comp) {
        skippedNodes.push(
          this.renderComponent(comp, surface, catalogRenderers, registry)
        );
      }
    }

    return [mainContent, skippedNodes];
  }

  /** Render component but skip children whose IDs are in the skip set */
  private renderComponentFiltered(
    comp: A2UIComponent,
    surface: SurfaceState,
    catalogRenderers: Record<string, React.ComponentType<import("./a2ui-catalog").A2UIComponentProps>>,
    registry: CatalogRegistry,
    skipIds: Set<string>
  ): React.ReactNode {
    // If this component itself should be skipped, don't render it
    if (skipIds.has(comp.id)) return null;

    const Renderer = catalogRenderers[comp.component];
    if (!Renderer) return null;

    const children: React.ReactNode[] = [];

    if (comp.children && Array.isArray(comp.children)) {
      for (const childId of comp.children) {
        if (skipIds.has(childId)) continue;
        const childComp = surface.components.get(childId);
        if (childComp) {
          children.push(
            this.renderComponentFiltered(childComp, surface, catalogRenderers, registry, skipIds)
          );
        }
      }
    }

    if (comp.child) {
      if (!skipIds.has(comp.child)) {
        const childComp = surface.components.get(comp.child);
        if (childComp) {
          children.push(
            this.renderComponentFiltered(childComp, surface, catalogRenderers, registry, skipIds)
          );
        }
      }
    }

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
