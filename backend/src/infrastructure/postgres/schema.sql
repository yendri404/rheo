-- Idempotent schema, applied on every boot (as a single transaction).
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  address       text NOT NULL DEFAULT '',
  role          text NOT NULL CHECK (role IN ('driver', 'passenger')),
  push_token    text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_name_key ON companies (lower(name));

-- A company's routes rotate in "position" order.
CREATE TABLE IF NOT EXISTS routes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('pickup', 'dropoff')),
  position   integer NOT NULL
);

CREATE INDEX IF NOT EXISTS routes_company ON routes (company_id, position);

-- Which companies a user is registered in.
CREATE TABLE IF NOT EXISTS user_companies (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS user_companies_company ON user_companies (company_id);

-- route_name/route_kind are a snapshot taken at start: editing or deleting a route never changes a trip.
CREATE TABLE IF NOT EXISTS trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  company_id  uuid NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  route_id    uuid REFERENCES routes (id) ON DELETE SET NULL,
  route_name  text NOT NULL,
  route_kind  text NOT NULL CHECK (route_kind IN ('pickup', 'dropoff')),
  driver_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  status      text NOT NULL CHECK (status IN ('active', 'finished')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz
);

-- One-time upgrade of a database created before companies existed (trips had a fixed "route"
-- column and no company): everything that existed becomes part of the company "Eureka".
DO $$
DECLARE
  eureka uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'trips' AND column_name = 'company_id'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO companies (name) VALUES ('Eureka') RETURNING id INTO eureka;
  INSERT INTO routes (company_id, name, kind, position)
  VALUES (eureka, 'Mañana', 'pickup', 0), (eureka, 'Norte', 'dropoff', 1), (eureka, 'Sur', 'dropoff', 2);
  INSERT INTO user_companies (user_id, company_id) SELECT id, eureka FROM users;

  ALTER TABLE trips
    ADD COLUMN company_id uuid REFERENCES companies (id) ON DELETE CASCADE,
    ADD COLUMN route_id   uuid REFERENCES routes (id) ON DELETE SET NULL,
    ADD COLUMN route_name text,
    ADD COLUMN route_kind text CHECK (route_kind IN ('pickup', 'dropoff')),
    ADD COLUMN driver_id  uuid REFERENCES users (id) ON DELETE SET NULL;

  UPDATE trips t
  SET company_id = eureka, route_id = r.id, route_name = r.name, route_kind = r.kind
  FROM routes r
  WHERE r.company_id = eureka
    AND r.position = CASE t.route WHEN 'manana' THEN 0 WHEN 'norte' THEN 1 ELSE 2 END;

  ALTER TABLE trips
    ALTER COLUMN company_id SET NOT NULL,
    ALTER COLUMN route_name SET NOT NULL,
    ALTER COLUMN route_kind SET NOT NULL;
  ALTER TABLE trips DROP COLUMN route;
END $$;

-- At most one active trip per company, enforced by the database even under concurrent starts.
DROP INDEX IF EXISTS trips_one_active;
DROP INDEX IF EXISTS trips_seq;
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active_per_company ON trips (company_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS trips_company_seq ON trips (company_id, seq DESC);

CREATE TABLE IF NOT EXISTS trip_passengers (
  trip_id      uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL,
  confirmed_at timestamptz,
  PRIMARY KEY (trip_id, user_id)
);
