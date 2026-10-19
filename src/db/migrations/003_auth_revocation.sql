-- Harden the pinned local adapter. Password/factor changes invalidate pending
-- second-factor proofs as well as live sessions, inside the provider transaction.
CREATE FUNCTION revoke_local_auth() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM session WHERE "userId"=NEW."userId";
  DELETE FROM verification WHERE value=NEW."userId"::text;
  UPDATE users SET security_version=security_version+1 WHERE auth_provider='better-auth-local' AND auth_subject=NEW."userId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER password_revokes AFTER UPDATE OF password ON account
FOR EACH ROW WHEN (OLD.password IS DISTINCT FROM NEW.password)
EXECUTE FUNCTION revoke_local_auth();

CREATE FUNCTION revoke_local_factors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM session WHERE "userId"=NEW.id;
  DELETE FROM verification WHERE value=NEW.id::text;
  UPDATE users SET security_version=security_version+1 WHERE auth_provider='better-auth-local' AND auth_subject=NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER factor_revokes AFTER UPDATE OF "twoFactorEnabled" ON "user"
FOR EACH ROW WHEN (COALESCE(OLD."twoFactorEnabled",false) IS DISTINCT FROM COALESCE(NEW."twoFactorEnabled",false))
EXECUTE FUNCTION revoke_local_factors();

CREATE UNIQUE INDEX one_credential_account ON account("userId") WHERE "providerId"='credential';
CREATE UNIQUE INDEX one_factor_per_user ON "twoFactor"("userId");
