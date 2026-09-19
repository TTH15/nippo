-- 使い捨てDB専用。166は別途実スキーマの専用開発DBでも検証する。
DO $$ BEGIN IF current_database()<>'hakotora_security_test' THEN RAISE EXCEPTION 'Wrong test database'; END IF; END $$;
CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,name text,status text);
CREATE TABLE identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phone text,phone_verified_at timestamptz,pin_hash text);
CREATE TABLE drivers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,role text,org_id uuid REFERENCES organizations(id),identity_id uuid REFERENCES identities(id),status text,pin_hash text);
CREATE TABLE passkey_credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identity_id uuid REFERENCES identities(id),credential_id text UNIQUE,public_key bytea,counter bigint,transports text[],device_type text,backed_up boolean,name text,created_at timestamptz DEFAULT now(),last_used_at timestamptz);
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid REFERENCES organizations(id),driver_id uuid REFERENCES drivers(id),identity_id uuid REFERENCES identities(id),kind text,title text,body text,payload jsonb);
