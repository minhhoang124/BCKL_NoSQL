-- FR-ACC-04: security history contains neither passwords/hashes nor tokens.
CREATE TABLE "account_security_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "event" TEXT NOT NULL,
  "fromVersion" INTEGER NOT NULL,
  "toVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_security_event_kind" CHECK ("event" = 'PASSWORD_CHANGED'),
  CONSTRAINT "account_security_event_versions" CHECK ("fromVersion" >= 1 AND "toVersion"::BIGINT = "fromVersion"::BIGINT + 1),
  CONSTRAINT "account_security_event_once" UNIQUE ("userId", "toVersion")
);
CREATE FUNCTION "account_security_event_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Security events are immutable';
END;
$$;
CREATE TRIGGER "account_security_event_immutable"
  BEFORE UPDATE OR DELETE ON "account_security_events"
  FOR EACH ROW EXECUTE FUNCTION "account_security_event_immutable"();
