// A2UI v0.9 protocol types

export interface A2UICreateSurface {
  version: "v0.9";
  createSurface: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
    sendDataModel?: boolean;
  };
}

export interface A2UIUpdateComponents {
  version: "v0.9";
  updateComponents: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface A2UIUpdateDataModel {
  version: "v0.9";
  updateDataModel: {
    surfaceId: string;
    path?: string;
    value?: unknown;
  };
}

export interface A2UIDeleteSurface {
  version: "v0.9";
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | A2UICreateSurface
  | A2UIUpdateComponents
  | A2UIUpdateDataModel
  | A2UIDeleteSurface;

export interface A2UIComponent {
  id: string;
  component: string;
  children?: string[];
  child?: string;
  text?: string | { path: string };
  variant?: string;
  action?: { event: { name: string; context?: Record<string, unknown> } };
  [key: string]: unknown;
}

export type A2UIEventName =
  | "a2ui_create_surface"
  | "a2ui_update_components"
  | "a2ui_update_data_model"
  | "a2ui_delete_surface";
