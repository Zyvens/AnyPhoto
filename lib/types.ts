export type DeviceRole = 'unassigned' | 'control' | 'camera';

export type AnyPhotoDevice = {
  id: string;
  device_key: string;
  name: string;
  role: DeviceRole;
  capabilities: Record<string, unknown>;
  last_seen: string;
  online: boolean;
};

export type CaptureSession = {
  id: string;
  name: string;
  status: 'active' | 'stopped';
  controller_device_id: string;
  created_at: string;
  cameras?: AnyPhotoDevice[];
};

export type MediaItem = {
  id: string;
  session_id: string | null;
  source_device_id: string;
  source_name?: string;
  kind: 'photo' | 'video';
  filename: string;
  mime_type: string;
  byte_size: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  local_object_key: string | null;
  thumbnail_data_url: string | null;
  cloud_url: string | null;
  transfer_status: 'source_only' | 'transferred' | 'cloud';
  original_retained: boolean;
  created_at: string;
};

export type RemoteCommand = {
  type: 'command';
  command: string;
  payload?: Record<string, unknown>;
};
