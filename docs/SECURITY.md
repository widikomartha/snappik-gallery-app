# Security and privacy boundaries

This is a mandatory engineering contract, **not a security certification or legal opinion**. The product has four distinct principals: visitor, studio owner, gallery client with *workflow-specific grant*, and platform operator.

## Permission matrix

| Action | Studio owner | Main grant | Download grant | Operator |
|---|---|---|---|---|
| Studio/project config | Within active entitlement | No | No | No general edit |
| Studio results / confirmations | Own studio | Read own current main state only | No | No by default |
| Select/edit/confirm | No implicit client-cookie bypass; owner may use explicit supported service | Yes if unlocked/within deadline | No | No |
| Download original | Owner preview rights do **not** imply unguarded URL | No | Yes if eligible | No by default |
| Reopen | Own studio + active entitlement + reason | No | No | No |
| Operate grants/suspension | No | No | No | Specific permission + fresh MFA + reason |

## Hard controls

1. **Tenant authorization:** validate session + membership and canonical studio/project scope in service and repository access. Composite scoped FKs, denial tests with a second tenant. Never trust client-supplied `studio_id` or labels.
2. **Auth:** approved session provider, verified account identity, server expiry and durable revocation. Logout returns success only after durable denial of old sessions; storage uncertainty is retryable failure. Recovery must be single-use/expiring, resist concurrent reset/login replay, keep enrollment and previous studio data. Do not write a parallel credential system when existing reviewed provider logic exists.
3. **Gallery:** unguessable bearer share token is discovery only; per-menu password/grant, bounded expiry and access-version checks apply at **every** protected API/media call. One workflow cannot borrow the other's grant. Studio suspend/archive immediately invalidates client access.
4. **Drive:** validate folder/file IDs and authorized root ancestry. Never fetch arbitrary user URLs or follow off-root shortcuts. Provider tokens/keys stay server-side encrypted with owner-scoped lifecycle; revoked provider access must fail safe. Original Drive ACL is not controlled by Snappik.
5. **Media:** private storage, no public derived-image bucket, source-version invalidation, no cache cross-tenant leak, bounded content size/time/decoder resource use, downstream cancellation and scratch cleanup.
6. **Input:** CSRF/Origin for cookie-bound mutations; strict JSON bounds, field allowlists and plain-text output encoding for notes. CSV formula injection mitigation; `Content-Disposition` sanitized. Throttle gallery password, authentication/recovery and privileged actions. Do not describe current local throttles as production-wide protection without distributed validation.
7. **Operator:** explicit scoped permission, recent actual factor verification (not an MFA-enrolled flag), reason + atomic audit. No default impersonation, gallery browsing, raw DB editor or role self-grant.
8. **Logging:** redact bearer URLs/query strings, tokens, cookies, passwords, notes, original media and provider secrets. Check **hosting/edge request-path logs** independently of application logs before production. Correlation IDs and safe error codes are permitted.
9. **Retention:** archive restore window and cache/log/audit/backup settings in `BUSINESS_RULES.md` are engineering defaults, pending approved privacy/legal/data processor policy. Verify deletion and revocation after restoring older backups; a DB restore alone could resurrect old access.
10. **Test data:** use synthetic studios and generated photographs. Never use audited competitor credentials or client images; don't place secrets in handoffs, fixtures, screenshots or markdown.

## Release security proof

Local EPIC-04 client routes validate a workflow-specific grant independently of owner identity and URL possession on every protected request. Random grant values use distinct HttpOnly/SameSite=Strict cookies scoped to the gallery API path; hashes, current access versions, studio state, archive and database-clock deadlines govern authorization. Password attempt counters are durable and scoped by project/workflow; slow hash verification holds no business transaction, followed by a fresh policy check before issuance. Client media repeats grant authorization around live provider visibility checks using the existing bounded private-preview reader. Local HTTP cookies intentionally omit Secure because the configuration rejects hosted mode; HTTPS/Secure and edge-log proof remain release gates. No production-wide password-abuse or real-provider proof is inferred from local tests.

- Unauthorized tenant ID substitutions are denied by all implemented owner/list/detail/export/media/job routes (not just UI).
- Different gallery workflow cookies are independently checked, including expiry equality, revocation, password change, archive and suspension.
- Confirm/save/reopen/archive races with separate DB connections cannot duplicate confirmation or lose acknowledged records.
- External origin, JSON overlarge bodies, malformed IDs, redirect and SSRF payloads are rejected without sensitive leaks.
- Provider and hosting integration tests verify storage privacy, redirect safety, token-log suppression and restart/revocation behavior.
- Backup restore in isolated staging replays newer revocations/deletions **before opening galleries**.

See `QUALITY.md` for test execution. A mock or local HTTP run does not pass external provider or production security gates.

**Local EPIC-03 boundary:** owner inventory and preview routes use the existing verified-session/tenant transaction on every request, including cached bytes; EPIC-04 adds a separate current-workflow-grant boundary for client routes. Archive/suspension/unavailable photos deny previews. Source permission denial remains sticky across cancellation/retry until a successful complete scan revalidates the source. Generated previews and the separately approved local public source use private DB bytes, with no public bucket or arbitrary URL fetch. The public-only adapter uses fixed HTTPS Google endpoints, encrypted local API/root-key configuration, API key in headers, redirect rejection, bounded metadata/media and transient resource keys. Local mode requires an allowlisted root and explicit cache approval. Every public cached media request verifies current parent membership/root/file version outside a transaction and then repeats current owner authorization; expiry or concurrent archive/session/source changes deny bytes. Public caches have a seven-day absolute ceiling and worker cleanup. Dedicated resource-key-required/actual ACL revocation/limited-child proof, key restrictions/rotation and hosted native decoder limits remain D-02/D-03 gates.
