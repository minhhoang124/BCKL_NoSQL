-- Additive: legacy Store/Role/history are not rewritten or treated as a grant.
ALTER TABLE account_security_events DROP CONSTRAINT account_security_event_kind;
ALTER TABLE account_security_events ADD CONSTRAINT account_security_event_kind CHECK(event IN ('PASSWORD_CHANGED','SELLER_GRANTED'));
CREATE UNIQUE INDEX "stores_id_sellerId_key" ON stores(id,"sellerId");
CREATE TABLE store_applications (
 "storeId" INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 "contactName" VARCHAR(100) NOT NULL CHECK(length(btrim("contactName")) BETWEEN 2 AND 100),
 "contactPhone" VARCHAR(20) NOT NULL CHECK("contactPhone" ~ '^\+?[0-9]{9,15}$'),
 "pickupAddress" VARCHAR(500) NOT NULL CHECK(length(btrim("pickupAddress")) BETWEEN 10 AND 500),
 "returnAddress" VARCHAR(500) NOT NULL CHECK(length(btrim("returnAddress")) BETWEEN 10 AND 500),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE store_application_audits (
 id BIGSERIAL PRIMARY KEY,
 "storeId" INTEGER NOT NULL REFERENCES store_applications("storeId") ON DELETE RESTRICT ON UPDATE NO ACTION,
 "actorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 action VARCHAR(12) NOT NULL CHECK(action IN ('submit','edit','resubmit','review')),
 "fromRevision" INTEGER NOT NULL CHECK("fromRevision">=0),
 "toRevision" INTEGER NOT NULL CHECK("toRevision">0 AND "toRevision"::bigint="fromRevision"::bigint+1),
 "fromStatus" "StoreStatus",
 "toStatus" "StoreStatus" NOT NULL,
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT store_application_audit_shape CHECK ((
  (action='submit' AND "fromRevision"=0 AND "toRevision"=1 AND "fromStatus" IS NULL AND "toStatus"='PENDING') OR
  (action='edit' AND "fromStatus" IN ('PENDING','REJECTED','ACTIVE') AND "toStatus"="fromStatus") OR
  (action='resubmit' AND "fromStatus"='REJECTED' AND "toStatus"='PENDING') OR
  (action='review' AND (("fromStatus"='PENDING' AND "toStatus" IN ('ACTIVE','REJECTED')) OR
   ("fromStatus"='ACTIVE' AND "toStatus"='SUSPENDED') OR ("fromStatus"='SUSPENDED' AND "toStatus"='ACTIVE')))
 ) IS TRUE),
 CHECK(action='submit' OR "fromRevision">0)
);
CREATE UNIQUE INDEX "store_application_audits_storeId_toRevision_key" ON store_application_audits("storeId","toRevision");
CREATE TABLE store_seller_grants (
 "storeId" INTEGER PRIMARY KEY,
 "ownerId" INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "adminId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "auditId" BIGINT NOT NULL UNIQUE REFERENCES store_application_audits(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 promoted BOOLEAN NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT store_grant_owner_fk FOREIGN KEY("storeId","ownerId") REFERENCES stores(id,"sellerId") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE TABLE store_application_commands (
 id BIGSERIAL PRIMARY KEY,
 "actorId" INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 "commandId" UUID NOT NULL,
 scope VARCHAR(8) NOT NULL CHECK(scope IN ('OWNER','ADMIN')),
 action VARCHAR(12) NOT NULL,
 "targetId" INTEGER NOT NULL CHECK("targetId">0),
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[0-9a-f]{64}$'),
 outcome VARCHAR(8) NOT NULL CHECK(outcome IN ('APPLIED','CLOSED')),
 "storeId" INTEGER REFERENCES store_applications("storeId") ON DELETE RESTRICT ON UPDATE NO ACTION,
 "auditId" BIGINT UNIQUE REFERENCES store_application_audits(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
 receipt JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((scope='OWNER' AND action IN ('submit','edit','resubmit')) OR (scope='ADMIN' AND action='review')),
 CHECK((outcome='CLOSED' AND "storeId" IS NULL AND "auditId" IS NULL AND receipt IS NULL) OR
  (outcome='APPLIED' AND "storeId" IS NOT NULL AND "auditId" IS NOT NULL AND receipt IS NOT NULL AND jsonb_typeof(receipt)='object'))
);
CREATE UNIQUE INDEX "store_seller_grants_storeId_ownerId_key" ON store_seller_grants("storeId","ownerId");
CREATE UNIQUE INDEX "store_application_commands_actorId_commandId_key" ON store_application_commands("actorId","commandId");

CREATE FUNCTION store_onboarding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Store onboarding ledger is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER store_application_audit_immutable BEFORE UPDATE OR DELETE ON store_application_audits FOR EACH ROW EXECUTE FUNCTION store_onboarding_immutable();
CREATE TRIGGER store_application_command_immutable BEFORE UPDATE OR DELETE ON store_application_commands FOR EACH ROW EXECUTE FUNCTION store_onboarding_immutable();
CREATE TRIGGER store_seller_grant_immutable BEFORE UPDATE OR DELETE ON store_seller_grants FOR EACH ROW EXECUTE FUNCTION store_onboarding_immutable();

CREATE FUNCTION store_application_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."storeId"<>OLD."storeId" OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN
  RAISE EXCEPTION 'Application revision must advance once' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_application_revision BEFORE UPDATE ON store_applications FOR EACH ROW EXECUTE FUNCTION store_application_revision();

CREATE FUNCTION store_grant_audit_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM store_application_audits a JOIN stores s ON s.id=a."storeId"
  JOIN users u ON u.id=s."sellerId" WHERE a.id=NEW."auditId" AND a."storeId"=NEW."storeId"
  AND a."actorId"=NEW."adminId" AND a.action='review' AND a."fromStatus"='PENDING'
  AND a."toStatus"='ACTIVE' AND s.status='ACTIVE' AND u.role='SELLER') THEN
  RAISE EXCEPTION 'Invalid Seller grant audit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_grant_audit_binding BEFORE INSERT ON store_seller_grants FOR EACH ROW EXECUTE FUNCTION store_grant_audit_binding();

CREATE FUNCTION store_command_audit_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.outcome='APPLIED' AND NOT EXISTS(
  SELECT 1 FROM store_application_audits a JOIN stores s ON s.id=a."storeId"
  WHERE a.id=NEW."auditId" AND a."storeId"=NEW."storeId" AND a."actorId"=NEW."actorId" AND a.action=NEW.action
  AND NEW."targetId"=CASE WHEN NEW.action='submit' THEN s."sellerId" ELSE s.id END
  AND NEW.receipt->>'auditId'=a.id::text
  AND NEW.receipt->>'storeId'=s.id::text AND jsonb_typeof(NEW.receipt->'storeId')='number'
  AND NEW.receipt->>'ownerId'=s."sellerId"::text AND jsonb_typeof(NEW.receipt->'ownerId')='number'
  AND NEW.receipt->>'revision'=a."toRevision"::text AND jsonb_typeof(NEW.receipt->'revision')='number'
  AND NEW.receipt->>'status'=a."toStatus"::text AND jsonb_typeof(NEW.receipt->'status')='string'
  AND jsonb_typeof(NEW.receipt->'grantCreated')='boolean'
  AND jsonb_typeof(NEW.receipt->'reauthenticationRequired')='boolean'
 ) THEN RAISE EXCEPTION 'Invalid application receipt audit binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_command_audit_binding BEFORE INSERT ON store_application_commands FOR EACH ROW EXECUTE FUNCTION store_command_audit_binding();

-- Validate final state at COMMIT: profile/revision, audit and grant are one unit.
CREATE FUNCTION store_application_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target INTEGER; current_status "StoreStatus"; current_revision INTEGER; owner_role "Role";
BEGIN
 IF TG_TABLE_NAME='stores' THEN target:=NEW.id; ELSE target:=NEW."storeId"; END IF;
 SELECT s.status,a.revision,u.role INTO current_status,current_revision,owner_role
 FROM stores s JOIN store_applications a ON a."storeId"=s.id JOIN users u ON u.id=s."sellerId" WHERE s.id=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM store_application_audits a WHERE a."storeId"=target AND a."toRevision"=current_revision AND a."toStatus"=current_status) THEN
  RAISE EXCEPTION 'Application final revision/status needs audit' USING ERRCODE='23514';
 END IF;
 IF current_status IN ('ACTIVE','SUSPENDED') AND (owner_role<>'SELLER' OR NOT EXISTS(SELECT 1 FROM store_seller_grants g WHERE g."storeId"=target)) THEN
  RAISE EXCEPTION 'Active onboarding Store needs Seller grant' USING ERRCODE='23514';
 END IF;
 IF current_status IN ('PENDING','REJECTED') AND EXISTS(SELECT 1 FROM store_seller_grants g WHERE g."storeId"=target) THEN
  RAISE EXCEPTION 'Pending onboarding Store cannot keep active grant' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER store_application_consistent AFTER INSERT OR UPDATE ON store_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION store_application_consistent();
CREATE CONSTRAINT TRIGGER store_application_store_consistent AFTER INSERT OR UPDATE ON stores DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION store_application_consistent();
CREATE CONSTRAINT TRIGGER store_application_grant_consistent AFTER INSERT ON store_seller_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION store_application_consistent();

CREATE FUNCTION store_application_owner_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."sellerId"<>OLD."sellerId" AND EXISTS(SELECT 1 FROM store_applications a WHERE a."storeId"=OLD.id) THEN
  RAISE EXCEPTION 'Application owner cannot change' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_application_owner_immutable BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION store_application_owner_immutable();
