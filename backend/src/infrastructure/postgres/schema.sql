-- Idempotent schema, applied on every boot.
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

CREATE TABLE IF NOT EXISTS trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  route       text NOT NULL CHECK (route IN ('manana', 'norte', 'sur')),
  status      text NOT NULL CHECK (status IN ('active', 'finished')),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz
);

-- At most one active trip, enforced by the database even under concurrent starts.
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_active ON trips ((true)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS trips_seq ON trips (seq DESC);

CREATE TABLE IF NOT EXISTS trip_passengers (
  trip_id      uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  joined_at    timestamptz NOT NULL,
  confirmed_at timestamptz,
  PRIMARY KEY (trip_id, user_id)
);
