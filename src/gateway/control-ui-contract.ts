export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";
export const CONTROL_UI_FILE_DOWNLOAD_PATH = "/__openclaw/files/download";
export const CONTROL_UI_FILE_OPEN_PATH = "/__openclaw/files/open";

export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAgentId: string;
  serverVersion?: string;
};
