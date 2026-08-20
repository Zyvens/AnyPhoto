-- AnyPhoto application schema. Apply through Neon migration workflow.
CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, device_key text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT 'Dispositivo', role text NOT NULL DEFAULT 'unassigned' CHECK (role IN ('unassigned','control','camera')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb, last_seen timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS devices_user_seen_idx ON public.devices (user_id, last_seen DESC);
CREATE TABLE IF NOT EXISTS public.capture_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, name text NOT NULL DEFAULT 'Sessão AnyPhoto',
  controller_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stopped')),
  created_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz
);
CREATE INDEX IF NOT EXISTS capture_sessions_user_status_idx ON public.capture_sessions (user_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS public.session_cameras (
  session_id uuid NOT NULL REFERENCES public.capture_sessions(id) ON DELETE CASCADE, camera_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  label text, position_index integer NOT NULL DEFAULT 0, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (session_id, camera_device_id)
);
CREATE INDEX IF NOT EXISTS session_cameras_camera_idx ON public.session_cameras (camera_device_id, session_id);
CREATE TABLE IF NOT EXISTS public.signaling_messages (
  id bigserial PRIMARY KEY, user_id text NOT NULL, session_id uuid NOT NULL REFERENCES public.capture_sessions(id) ON DELETE CASCADE,
  from_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE, to_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  message_type text NOT NULL CHECK (message_type IN ('offer','answer','ice','command','ack')), payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signaling_to_device_idx ON public.signaling_messages (to_device_id, session_id, id);
CREATE TABLE IF NOT EXISTS public.media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, session_id uuid REFERENCES public.capture_sessions(id) ON DELETE SET NULL,
  source_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE, kind text NOT NULL CHECK (kind IN ('photo','video')), filename text NOT NULL,
  mime_type text NOT NULL, byte_size bigint NOT NULL DEFAULT 0, duration_ms integer, width integer, height integer, local_object_key text, thumbnail_data_url text,
  cloud_url text, transfer_status text NOT NULL DEFAULT 'source_only' CHECK (transfer_status IN ('source_only','transferred','cloud')), original_retained boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS media_items_user_created_idx ON public.media_items (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS media_items_source_idx ON public.media_items (source_device_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS public.command_events (
  id bigserial PRIMARY KEY, user_id text NOT NULL, session_id uuid REFERENCES public.capture_sessions(id) ON DELETE SET NULL,
  from_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE, to_device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  command text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','acked','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS command_events_session_idx ON public.command_events (session_id, created_at DESC);
