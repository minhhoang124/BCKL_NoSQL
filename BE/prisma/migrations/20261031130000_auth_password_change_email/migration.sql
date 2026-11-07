-- Email-confirmed password change (purpose CHANGE_PASSWORD). Additive; feature stays
-- disabled until AUTH_PASSWORD_CHANGE_MODE=EMAIL. Existing tokens are not touched.
ALTER TABLE auth_email_tokens ADD COLUMN "bindingHash" VARCHAR(64);
ALTER TABLE auth_email_tokens DROP CONSTRAINT auth_email_tokens_purpose_check;
ALTER TABLE auth_email_tokens ADD CONSTRAINT auth_email_tokens_purpose_check
 CHECK(purpose IN ('VERIFY_EMAIL','RESET_PASSWORD','CHANGE_PASSWORD'));
-- A change challenge is always bound to the requesting browser; other purposes never are.
ALTER TABLE auth_email_tokens ADD CONSTRAINT auth_email_token_binding CHECK(
 ("bindingHash" IS NULL OR "bindingHash" ~ '^[a-f0-9]{64}$') AND
 ((purpose = 'CHANGE_PASSWORD') = ("bindingHash" IS NOT NULL)));
