import { invoke } from '@tauri-apps/api/core';

export interface ServiceInfo {
  id: string;
  name: string;
  description: string;
  default_port: number;
}

export interface ServiceStatus {
  service: string;
  running: boolean;
  pid?: number;
  port: number;
  uptime_secs?: number;
  error?: string;
}

export interface FtpUser {
  login: string;
  password: string;
  rootDir?: string;
}

export interface ServiceConfig {
  port: number;
  rootDir?: string;
  args: string[];
  showDownloadMsg?: boolean;
  showUploadMsg?: boolean;
  autoStopEnabled?: boolean;
  autoStopSecs?: number;
  ftpUsers?: FtpUser[];
  allowAnonymous?: boolean;
  useUtf8?: boolean;
  promptBeforeConnect?: boolean;
}

export interface ServerLogEntry {
  service: string;
  message: string;
  timestamp: string;
}

export const ServerService = {
  list: () => invoke<ServiceInfo[]>('list_services'),
  status: (service: string) => invoke<ServiceStatus>('service_status', { service }),
  start: (service: string) => invoke<ServiceStatus>('start_service', { service }),
  stop: (service: string) => invoke<ServiceStatus>('stop_service', { service }),
  updateConfig: (service: string, config: ServiceConfig) =>
    invoke('update_service_config', { service, config }),
  getConfig: (service: string) => invoke<ServiceConfig>('get_service_config', { service }),
};
