# MCP agent access, slice 1 (foundation) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a Streamable HTTP MCP endpoint on the BibleFuel server, with per-user agent keys, daily caps, publish consent, an activity log, the first tools (account, jobs, media), a Settings card, and the end-to-end guide.

**Architecture:** `POST /api/mcp` builds a fresh `McpServer` per request from a declarative tool catalogue; each tool handler calls the server's own REST API over loopback with a 60-second internal JWT, so every existing middleware (scoping, quota, verified email, super-admin) runs unchanged. Agent keys live in `DATA_DIR/agent-keys.json` (hashed), caps and activity in sibling files, and the registry wraps every tool with the consent, cap and logging checks.

**Tech Stack:** Node 22 ES modules, Express 4, `@modelcontextprotocol/sdk` 1.32.x (v1 line), Zod 3.25, `jsonwebtoken`, `express-rate-limit`, `node:test` + `supertest`; React 19 + Vite + Vitest + Testing Library on the client, `react-markdown` + `remark-gfm` for the guide.

**Spec:** `docs/superpowers/specs/2026-10-23-mcp-agent-access-design.md`

## Global Constraints

- Branch `feat/mcp-agents` off `origin/master` (the lyric, moments and scene-script routes live there), in its own worktree; every task commits; nothing is pushed until the operator says so.
- Server dependency changes: add `@modelcontextprotocol/sdk@^1.32.2`; bump `zod` from `^3.23.8` to `^3.25.0` (the SDK's peer floor; the 3.x API is unchanged). Client: add `react-markdown` and `remark-gfm`.
- Keys are `bfk_` + 32 random bytes base64url, shown once, stored as SHA-256; constant-time compare; at most 10 live keys per user.
- A key authenticates only at `/api/mcp`, from the `Authorization` header only; the app's `requireAuth` never accepts a key.
- Internal loopback JWT: claims `sub, email, role, emailVerified, via: "mcp"`, `expiresIn: "60s"`, signed with `JWT_SECRET`.
- `refuseAgentCalls` answers `403 { ok:false, error:"AGENT_FORBIDDEN" }` to any `req.user.via` of `"mcp"` or `"agent-key"` on: `DELETE /api/auth/me`, `/api/agent-keys`, `/api/billing` except `GET /usage`, `/api/admin`, `/api/access-requests`.
- Cap ceilings from env with defaults: `MCP_DAILY_RENDERS=10`, `MCP_DAILY_AI_VIDEO_USD=2`, `MCP_DAILY_IMAGES=30`, `MCP_DAILY_TTS=30`, `MCP_DAILY_PUBLISHES=3`; UTC day; a per-key cap may only be lower.
- Cap refusal: tool error `MCP_CAP_REACHED` with `{ bucket, used, limit, resetsAt }`, before any loopback call.
- Consent refusal: tool error `PUBLISH_NOT_ALLOWED: the key's owner has not allowed publishing. Ask them to switch it on in Settings → Connected agents`.
- `jobs_wait` polls every 3 s, `timeoutSec` at most 90.
- Rate limit `/api/mcp`: 120 requests per minute per key (per user id when a JWT is used).
- Log line per call: `[MCP] key=<first 8 chars of key id> tool=<name> ms=<n> ok|error`; never the key.
- Activity files `DATA_DIR/agent-activity/YYYY-MM-DD.jsonl`, 90-day retention pruned on start; text inputs cut to 200 characters; never file bytes or keys.
- No `console.log` in new code; use `console.warn`/`console.error` for problems and the `[MCP]` info line through `console.info`.
- UI follows `docs/PRODUCT_DESIGN_SYSTEM.md` and the design-quality rule: existing `Card`, `Button`, `Input`; no new colours or styles.

## Review Focus

Inputs the spec implies but no task's tests cover unless added here. Each line's test is placed in the owning task below.

1. **A revoked key used mid-way through a long job.** `jobs_wait` must stop returning results once the key is revoked: the next MCP request gets 401 (Task 6 test "revoked key gets 401 on the next request").
2. **A URL import that redirects to a private address after passing the first check.** Each redirect hop must be re-checked (Task 10 test "a redirect to 127.0.0.1 is refused").
3. **Two agents sharing one key at once.** Cap charging must not lose a count under concurrent calls: charge is read-modify-write on one file, serialised in-process (Task 4 test "ten concurrent charges count ten").
4. **A key whose user was deleted.** `findByPlainKey` must treat it as revoked (Task 2 test "a key for a deleted user is not found").
5. **A JWT from the app used at `/api/mcp` with `?token=` in the query.** Must be refused; header only (Task 5 test "query token is refused").

---

### Task 0: Worktree, branch, dependencies, spec commit

**Files:**
- Create: worktree `C:\Users\segun\source\repos\bf-mcp` on branch `feat/mcp-agents`
- Modify: `server/package.json` (dependencies), `client/package.json` (dependencies)
- Copy: `docs/superpowers/specs/2026-10-23-mcp-agent-access-design.md`, `docs/superpowers/plans/2026-10-23-mcp-agent-access-slice-1.md` from the current checkout (both are untracked there)

- [ ] **Step 1: Create the worktree and branch**

```bash
cd /c/Users/segun/source/repos/biblefuel-studio
git fetch origin
git worktree add ../bf-mcp -b feat/mcp-agents origin/master
```
Expected: a new folder `bf-mcp` on `feat/mcp-agents` at the tip of `origin/master`.

- [ ] **Step 2: Copy the spec and this plan into the worktree, commit**

```bash
cp docs/superpowers/specs/2026-10-23-mcp-agent-access-design.md ../bf-mcp/docs/superpowers/specs/
cp docs/superpowers/plans/2026-10-23-mcp-agent-access-slice-1.md ../bf-mcp/docs/superpowers/plans/
cd ../bf-mcp && git add docs/superpowers && git commit -m "docs: MCP agent access design and slice 1 plan"
```

- [ ] **Step 3: Install dependencies in the worktree (its own `node_modules`, never a junction to the main checkout)**

```bash
cd /c/Users/segun/source/repos/bf-mcp
npm install --include=dev --prefix server @modelcontextprotocol/sdk@^1.32.2 zod@^3.25.0
npm install --include=dev --prefix client react-markdown remark-gfm
npm run install:all
```
Expected: `server/package.json` lists `@modelcontextprotocol/sdk` and `zod ^3.25.0`; `client/package.json` lists `react-markdown` and `remark-gfm`; both lockfiles updated.

- [ ] **Step 4: Confirm the SDK's v1 entry points resolve**

Run in `server/`:
```bash
node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(m=>console.info(Object.keys(m).includes('McpServer'), Object.keys(m).includes('ResourceTemplate'))); import('@modelcontextprotocol/sdk/server/streamableHttp.js').then(m=>console.info(Object.keys(m))); import('@modelcontextprotocol/sdk/client/streamableHttp.js').then(m=>console.info(Object.keys(m)))"
```
Expected: `true true`, a list containing `StreamableHTTPServerTransport`, a list containing `StreamableHTTPClientTransport`.

- [ ] **Step 5: Run the existing server and client test suites to record the baseline**

Run: `npm test --prefix server` and `npx vitest run --prefix client`
Expected: both green (note any pre-existing failures in the commit message of Step 6 so they are not blamed on this work).

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json client/package.json client/package-lock.json
git commit -m "chore: add MCP SDK, bump zod, add markdown renderer for the agent guide"
```

---

### Task 1: Shared constant-time compare

**Files:**
- Create: `server/src/lib/secrets.js`
- Modify: `server/src/routes/stemsWorker.js:27-32`, `server/src/routes/abi.js` (its private copy)
- Test: `server/src/lib/secrets.test.js`

**Interfaces:**
- Produces: `sameSecret(a: unknown, b: unknown): boolean` — SHA-256 both, `crypto.timingSafeEqual`.

- [ ] **Step 1: Write the failing test**

```js
test("sameSecret: equal strings true, different false, non-strings coerced", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("", undefined), false);
  assert.equal(sameSecret(123, "123"), true);
});
```

- [ ] **Step 2: Run it to verify it fails** — `node --test src/lib/secrets.test.js` → fails: module not found.

- [ ] **Step 3: Implement `sameSecret` in `server/src/lib/secrets.js`** (move the body from `stemsWorker.js`; `undefined` becomes the empty string, so `sameSecret("", undefined)` is `false` only because the two sides differ — make the test values reflect that: compare `""` with `"x"`).

- [ ] **Step 4: Replace the private copies** in `stemsWorker.js` and `abi.js` with an import from `../lib/secrets.js`.

- [ ] **Step 5: Run** `node --test src/lib/secrets.test.js src/routes/stemsWorker.test.js src/routes/abi.test.js` → all pass.

- [ ] **Step 6: Commit** — `git commit -m "refactor: one constant-time secret compare for workers, Abi and agent keys"`

---

### Task 2: Agent key store

**Files:**
- Create: `server/src/lib/agentKeys/store.js`
- Test: `server/src/lib/agentKeys/store.test.js`

**Interfaces:**
- Consumes: `DATA_DIR` from `../paths.js`; `getUsersStore()` from `../../auth.js`; `sameSecret` from `../secrets.js`.
- Produces:
  - `generateKey(): { plain: string, hash: string }` — `plain` is `bfk_` + base64url of 32 random bytes; `hash` is hex SHA-256 of `plain`.
  - `createKey(userId: string, name: string): { key: KeyRecord, plain: string }` — throws `Error("KEY_LIMIT")` at 10 live keys; `name` trimmed, 1–60 chars, else `Error("KEY_NAME")`.
  - `listKeys(userId): PublicKey[]` (no hash; includes `revokedAt` null rows only).
  - `revokeKey(userId, id): boolean`.
  - `updateKey(userId, id, patch: { publishAllowed?: boolean, caps?: Partial<Caps> }): PublicKey | null`.
  - `findByPlainKey(plain: string): KeyRecord | null` — null when unknown, revoked, or the user no longer exists in `users.json`; updates `lastUsedAt` at most once a minute.
  - Types (JSDoc): `KeyRecord = { id, hash, userId, name, createdAt, lastUsedAt, revokedAt, publishAllowed: boolean, caps: Partial<Caps> }`, `PublicKey = KeyRecord without hash, plus prefix: first 12 chars of plain ("bfk_" + 8)`, `Caps = { renders, aiVideoUsd, images, tts, publishes }` (numbers).
  - Store file `DATA_DIR/agent-keys.json`: `{ keys: KeyRecord[] }`; `id` is `ak_` + 16 hex.

- [ ] **Step 1: Write the failing tests** (set `process.env.DATA_DIR` to a fresh temp dir and write a `users.json` with users `u_1` and `u_2` before `await import()`):

```js
test("createKey returns the plain key once and lists it without the hash", ...)   // listKeys(u_1)[0] has no `hash`, has `prefix` === plain.slice(0,12), publishAllowed === false
test("findByPlainKey finds a live key and ignores a wrong one", ...)             // returns record with userId u_1; "bfk_nope" → null
test("revokeKey hides the key from findByPlainKey and listKeys", ...)
test("eleventh live key is refused with KEY_LIMIT", ...)
test("a key for a deleted user is not found", ...)                              // remove u_2 from users.json after creating its key → null
test("updateKey sets publishAllowed and lower caps", ...)                        // caps: { renders: 3 }
test("name is trimmed and bounded", ...)                                         // "   " → KEY_NAME; 61 chars → KEY_NAME
```

- [ ] **Step 2: Run** `node --test src/lib/agentKeys/store.test.js` → fails: module not found.
- [ ] **Step 3: Implement the store** (follow `usageStore.js`'s read/write style; `findByPlainKey` hashes the input once and compares with `sameSecret` against each hash so timing does not reveal which key matched).
- [ ] **Step 4: Run** the test file → all pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): agent key store with hashed keys, revoke, consent and caps"`

---

### Task 3: Internal JWT, agent-key auth middleware, and the agent-call backstop

**Files:**
- Create: `server/src/middleware/agentAuth.js`
- Modify: `server/src/auth.js` (export `signInternalToken`)
- Test: `server/src/middleware/agentAuth.test.js`

**Interfaces:**
- Consumes: `findByPlainKey` (Task 2); `jsonwebtoken`; `getUsersStore`.
- Produces:
  - `signInternalToken(user: { sub, email, role, emailVerified }): string` in `auth.js` — claims plus `via: "mcp"`, `expiresIn: "60s"`.
  - `requireAgentKeyOrJwt(req, res, next)` — reads only `Authorization: Bearer <value>`. If `value` starts with `bfk_`: `findByPlainKey`; on hit sets `req.user = { sub, email, role, emailVerified, via: "agent-key" }` from `users.json` and `req.agentKey = PublicKey`; else `401 { ok:false, error:"AGENT_KEY_INVALID" }`. Otherwise verifies it as a JWT exactly as `requireAuth` does (no query fallback) and sets `req.agentKey = null`. Missing header → `401 { ok:false, error:"Missing Bearer token" }`.
  - `refuseAgentCalls(req, res, next)` — `403 { ok:false, error:"AGENT_FORBIDDEN" }` when `req.user?.via` is `"mcp"` or `"agent-key"`.

- [ ] **Step 1: Write the failing tests** (an express app with `app.get("/p", requireAgentKeyOrJwt, (req,res)=>res.json({ user: req.user, key: req.agentKey }))` and `app.delete("/me", requireAuth, refuseAgentCalls, ...)`):

```js
test("a live agent key authenticates and exposes the public key record", ...)   // via "agent-key", key.id present, no hash
test("a revoked key is 401 AGENT_KEY_INVALID", ...)
test("an app JWT authenticates with agentKey null", ...)
test("query token is refused", ...)                                             // GET /p?token=<jwt> with no header → 401
test("an internal token is refused by refuseAgentCalls on DELETE /me", ...)      // signInternalToken(...) → 403 AGENT_FORBIDDEN; a normal signToken → passes
test("signInternalToken expires in 60 seconds and carries via=mcp", ...)          // decode: exp - iat === 60
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → passes.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): agent-key auth for the MCP endpoint and a backstop against agent calls on account routes"`

---

### Task 4: Daily caps

**Files:**
- Create: `server/src/lib/agentKeys/caps.js`
- Test: `server/src/lib/agentKeys/caps.test.js`

**Interfaces:**
- Produces:
  - `CAP_BUCKETS = ["renders","aiVideoUsd","images","tts","publishes"]`.
  - `ceilings(): Caps` — from env with the Global Constraints defaults (numbers; `aiVideoUsd` may be fractional).
  - `effectiveCaps(key: PublicKey | null): Caps` — `min(ceiling, key.caps[bucket])` per bucket; a JWT session (`key === null`) gets the ceilings.
  - `readKeyUsage(subjectId: string): { day, counts: Caps }` — `subjectId` is the key id, or `jwt:<userId>` for JWT sessions; file `DATA_DIR/agent-keys-usage.json` keyed by subject, lazy UTC-day rollover like `usageStore.js`.
  - `charge(subjectId, key, bucket, amount = 1): { ok: true, used, limit } | { ok: false, used, limit, resetsAt }` — refuses without writing when `used + amount > limit`; `resetsAt` is the next midnight UTC ISO string; writes are serialised through one in-process promise chain.
  - `capsSummary(subjectId, key): { [bucket]: { used, limit, remaining } }` (for `whoami`).

- [ ] **Step 1: Write the failing tests**

```js
test("ceilings read env with the spec defaults", ...)                       // unset → { renders:10, aiVideoUsd:2, images:30, tts:30, publishes:3 }; MCP_DAILY_RENDERS=4 → 4
test("a lower per-key cap wins; a higher one does not", ...)                // key.caps.renders 3 vs ceiling 10 → 3; key.caps.renders 50 → 10
test("charge counts up to the limit then refuses with resetsAt", ...)       // limit 2: ok, ok, then { ok:false, used:2, limit:2, resetsAt: /T00:00:00.000Z$/ }
test("fractional aiVideoUsd charges accumulate", ...)                       // 0.9 + 0.9 ok, 0.9 refused at limit 2
test("counters roll over at the UTC day boundary", ...)                     // stub todayUtc via an exported seam `_setClock(() => "2026-01-02")`
test("ten concurrent charges count ten", ...)                               // await Promise.all(10 × charge(..., "images")) → readKeyUsage().counts.images === 10
test("a super-admin key is capped like any other", ...)                     // effectiveCaps ignores role; charge refuses at the ceiling
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → passes.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): daily caps per agent key, serialised and UTC-rolled"`

---

### Task 5: Activity log

**Files:**
- Create: `server/src/lib/agentKeys/activity.js`
- Test: `server/src/lib/agentKeys/activity.test.js`

**Interfaces:**
- Produces:
  - `logActivity(entry: { keyId: string|null, keyName, userId, email, tool, input, ok: boolean, error: string|null, ms: number, job: {kind,id}|null, caps: Partial<Caps> }): void` — appends one JSON line with `ts` to `DATA_DIR/agent-activity/<YYYY-MM-DD>.jsonl`; `input` is passed through `redactInput` first.
  - `redactInput(input: unknown): unknown` — strings cut to 200 chars with `…`; any key named `authorization`, `token`, `key`, `apiKey` removed; buffers and typed arrays replaced by `"<bytes>"`; recursion depth 4.
  - `logKeyEvent(userId, keyId, event: "created"|"revoked"|"publish_on"|"publish_off"|"caps_changed", detail?: object)` — same file, `tool: "key:" + event`.
  - `readActivity({ userId?, keyId?, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", limit = 50 }): Entry[]` — newest first, only days in range, filtered.
  - `activityCsv(entries): string` — columns `ts,keyId,keyName,userId,email,tool,ok,error,ms,jobKind,jobId` (`csv-stringify`, already a dependency).
  - `pruneActivity(days = 90): number` — deletes files older than `days`, returns the count.

- [ ] **Step 1: Write the failing tests**

```js
test("logActivity appends a line to today's file with ts", ...)
test("redactInput cuts long text, drops secret-looking keys, replaces bytes", ...)   // 300-char string → 201 chars ending "…"; { token:"x", text:"y" } → { text:"y" }; Buffer → "<bytes>"
test("readActivity filters by user and key, newest first, limit", ...)
test("activityCsv has the header row and one row per entry", ...)
test("pruneActivity removes files older than 90 days and keeps the rest", ...)       // write 2026-01-01.jsonl and today's; prune → 1 removed
```

- [ ] **Step 2: Run** → fails. **Step 3: Implement.** **Step 4: Run** → passes.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): per-call activity log with redaction, CSV and 90-day pruning"`

---

### Task 6: Loopback API client and the MCP transport

**Files:**
- Create: `server/src/mcp/api.js`, `server/src/mcp/transport.js`, `server/src/mcp/registry.js`, `server/src/mcp/toolResult.js`
- Create: `server/test/helpers/mcpTestApp.js`
- Modify: `server/index.js` (mount `/api/mcp`)
- Test: `server/src/mcp/transport.test.js`, `server/src/mcp/api.test.js`

**Interfaces:**
- Consumes: Tasks 2–5; `signInternalToken` (Task 3).
- Produces:
  - `api.js`: `createApi({ user, baseUrl }): Api` where `Api.call(method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE", path: string, { body?, query? } = {}): Promise<any>` — `fetch(baseUrl + path + querystring)` with `Authorization: Bearer <signInternalToken(user)>` (minted per call), JSON body; returns the parsed body on 2xx; on non-2xx throws `ApiError { status, code, message, hint }` where `code` is the body's `error` when it is an UPPER_SNAKE token (`QUOTA_EXCEEDED`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN`, …) else `"HTTP_" + status`, and `message` is the body's `error` or `hint`.
  - `toolResult.js`: `ok(data): CallToolResult` → `{ content:[{type:"text", text: JSON.stringify(data, null, 2)}], structuredContent: data }`; `fail(code: string, message: string, extra?: object): CallToolResult` → `{ isError: true, content:[{type:"text", text: \`${code}: ${message}\`}], structuredContent: { error: code, message, ...extra } }`.
  - `registry.js`: `buildServer(ctx: McpCtx): McpServer` where `McpCtx = { user, agentKey: PublicKey|null, subjectId, isSuperAdmin: boolean, baseUrl, api: Api }`. It imports every `server/src/mcp/tools/*.js` default export (an array of `ToolDef`) and registers those whose `requires` the ctx satisfies (`undefined`, or `"super_admin"` when `ctx.isSuperAdmin`). `ToolDef = { name, title, description, inputSchema: ZodRawShape, requires?: "super_admin", publish?: boolean, caps?: { [bucket]: number | ((input) => number) }, handler(ctx, input): Promise<CallToolResult> }`. The wrapper around each handler, in order: consent check (`publish && agentKey && !agentKey.publishAllowed` → `fail("PUBLISH_NOT_ALLOWED", …)`), cap charge for each declared bucket (refusal → `fail("MCP_CAP_REACHED", …, { bucket, used, limit, resetsAt })`), then the handler, catching `ApiError` → `fail(code, message, { hint, status })` and any other error → `fail("INTERNAL", "Something went wrong")`; always `logActivity` and the `[MCP]` info line. Also registers the resource `biblefuel://guide` (text/markdown, from `docs/mcp.md`, Task 12 fills it; until then the file holds a placeholder heading).
  - `transport.js`: `createMcpRouter(): express.Router` — `router.use(requireAgentKeyOrJwt, rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: req => req.agentKey?.id || "jwt:" + req.user.sub }))`; `POST /` builds `ctx` (`baseUrl = "http://127.0.0.1:" + req.socket.localPort`, `subjectId = agentKey?.id || "jwt:" + user.sub`, `isSuperAdmin` via `isSuperAdmin(req.user)` from `lib/userPlan.js`), `const server = buildServer(ctx); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }); res.on("close", () => { transport.close(); server.close(); }); await server.connect(transport); await transport.handleRequest(req, res, req.body)`; `GET /` and `DELETE /` answer `405 { jsonrpc:"2.0", error:{ code:-32000, message:"Method not allowed." }, id:null }`.
  - `index.js`: `app.use("/api/mcp", createMcpRouter())` after `express.json` and before the SPA fallback; the host check uses the SDK's `hostHeaderValidation([...])` from `@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js` with the hosts from `MCP_ALLOWED_HOSTS` (comma list; default `localhost,127.0.0.1` plus the host part of each `CORS_ORIGIN` entry).
  - `test/helpers/mcpTestApp.js`: `startTestApp({ users, superAdminEmail? }): Promise<{ app, port, close(), dataDir, jwtFor(userId), keyFor(userId, name?) }>` — temp `DATA_DIR`, writes `users.json`, sets `JWT_SECRET`, dynamic-imports the modules, mounts `express.json`, `/api/auth` (real), `/api/billing` (real), `/api/jobs` (real) and `/api/mcp`, listens on port 0. Also `mcpClient(port, bearer): Promise<Client>` using `StreamableHTTPClientTransport(new URL(\`http://127.0.0.1:${port}/api/mcp\`), { requestInit: { headers: { Authorization: "Bearer " + bearer } } })` (confirm the option name against `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts` before relying on it).

- [ ] **Step 1: Write the failing transport tests** (`transport.test.js`, using the helper and a one-tool stub catalogue registered through a test seam `registry._setCatalogueForTests([...])`):

```js
test("initialize + tools/list work with an agent key", ...)                 // listTools() names include the stub "echo"
test("tools/call returns structuredContent", ...)                          // callTool({name:"echo", arguments:{ text:"hi" }}).structuredContent.text === "hi"
test("no bearer → 401; revoked key gets 401 on the next request", ...)      // call once ok, revokeKey, second listTools() rejects with 401
test("GET and DELETE answer 405 JSON-RPC", ...)
test("a super_admin-only tool is hidden from a normal user and visible to the admin", ...)
test("a publish tool refuses without consent and runs with it", ...)       // PUBLISH_NOT_ALLOWED text, then updateKey publishAllowed → ok
test("a capped tool refuses at the cap with MCP_CAP_REACHED", ...)          // MCP_DAILY_RENDERS=1, tool caps:{renders:1}: ok then error with structuredContent.bucket "renders"
test("every call is logged", ...)                                          // readActivity({ keyId }) has entries for each call, tool names match
test("rate limit answers 429 after 120 requests in a minute", ...)
```

- [ ] **Step 2: Write the failing api tests** (`api.test.js`, a tiny express app that records the Authorization header and answers 200/429/403):

```js
test("call sends a 60-second internal token and returns the body", ...)
test("QUOTA_EXCEEDED becomes ApiError with code and hint", ...)
test("an unknown error body becomes HTTP_<status>", ...)
```

- [ ] **Step 3: Run** both → fail. **Step 4: Implement** `api.js`, `toolResult.js`, `registry.js`, `transport.js`, the helper, and the `index.js` mount. **Step 5: Run** → pass.
- [ ] **Step 6: Run the whole server suite** `npm test --prefix server` → green.
- [ ] **Step 7: Commit** — `git commit -m "feat(mcp): Streamable HTTP endpoint with per-request servers, loopback API calls, consent, caps and logging"`

---

### Task 7: Agent key routes and the account backstop mounts

**Files:**
- Create: `server/src/routes/agentKeys.js`
- Modify: `server/index.js` (mount `/api/agent-keys`; add `refuseAgentCalls` to `DELETE /api/auth/me` via `routes/auth.js:291`, to `/api/billing` except `GET /usage`, `/api/admin`, `/api/access-requests`)
- Test: `server/src/routes/agentKeys.test.js`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces (all JWT only, `requireAuth, withUserScope, refuseAgentCalls`):
  - `GET /api/agent-keys` → `{ ok, endpoint: \`${proto}://${host}/api/mcp\`, ceilings: Caps, keys: (PublicKey & { usage: capsSummary })[] }`.
  - `POST /api/agent-keys { name }` → `201 { ok, key: PublicKey, plain }`; `KEY_LIMIT` → 409, `KEY_NAME` → 400.
  - `PATCH /api/agent-keys/:id { publishAllowed?, caps? }` → `{ ok, key }`; caps above the ceiling are clamped; logs `publish_on`/`publish_off`/`caps_changed`.
  - `DELETE /api/agent-keys/:id` → `{ ok }`; logs `revoked`.
  - `GET /api/agent-keys/activity?keyId&from&to&limit` → `{ ok, entries }` (own user only).
  - `GET /api/agent-keys/activity.csv?from&to` → `text/csv` attachment `agent-activity.csv`.

- [ ] **Step 1: Write the failing tests** (supertest with a real JWT; plus one with an internal token):

```js
test("create shows the plain key once; list never shows it", ...)
test("patch toggles consent and clamps caps to the ceiling", ...)      // caps.renders 999 → 10
test("delete revokes; the key then fails at /api/mcp", ...)
test("activity returns only the caller's entries", ...)
test("csv has the header row", ...)
test("an internal token is refused on every agent-keys route", ...)
test("DELETE /api/auth/me and POST /api/billing/checkout refuse an internal token", ...)
```

- [ ] **Step 2: Run** → fail. **Step 3: Implement** the router and mounts. **Step 4: Run** → pass. Run `npm test --prefix server` → green.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): agent key management routes and the agent-call backstop on account routes"`

---

### Task 8: System tools (`whoami`, `capabilities`)

**Files:**
- Create: `server/src/mcp/tools/system.js`
- Test: `server/src/mcp/tools/system.test.js`

**Interfaces:**
- Consumes: `ctx.api.call`, `capsSummary` (Task 4), `ok/fail`.
- Produces: default export `[whoami, capabilities]`.
  - `whoami` (no input) → `{ user: { id, email, role, isSuperAdmin, emailVerified }, plan, quota: usage.buckets, caps: capsSummary, key: { id, name, publishAllowed } | null }` from `GET /api/auth/me` and `GET /api/billing/usage`.
  - `capabilities` (no input) → `{ server: health.system, features: health.capabilities (the booleans), music: /api/music/capabilities, aiVideo: /api/video-gen/status }`.

- [ ] **Step 1: Write the failing tests** using `startTestApp` and `mcpClient`; assert `whoami` returns the test user's email, `plan` `"free"`, `caps.renders.limit === 10`, `key.publishAllowed === false`; `capabilities.features` is an object of booleans only.
- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): whoami and capabilities tools"`

---

### Task 9: Jobs tools and the first `jobs_wait` normalisers

**Files:**
- Create: `server/src/mcp/jobs.js`, `server/src/mcp/tools/jobs.js`
- Test: `server/src/mcp/jobs.test.js`, `server/src/mcp/tools/jobs.test.js`

**Interfaces:**
- Produces:
  - `jobs.js`: `JobHandle = { kind, id, projectId?: string, status: "queued"|"running"|"done"|"failed"|"cancelled", percent: number|null, phase: string|null, output: { url, path }|null, error: string|null }`; `NORMALISERS: { [kind]: { route(id, projectId): string, normalise(payload, { outputUrl }): JobHandle } }` for kinds `job`, `captioned`, `story`, `timeline`, `instrumental`, `publish` (the other kinds arrive with their feature slices); `outputUrl(path)` = `(process.env.MEDIA_PUBLIC_BASE || "")` + `/outputs/...` resolved the way `client/src/lib/api.ts mediaUrl` does; `waitForJob(api, { kind, id, projectId, timeoutSec }): Promise<JobHandle>` polls every 3 s (injectable `sleep` for tests) until a terminal status or the timeout, `timeoutSec` clamped to 1..90.
  - Mapping rules the builder follows (read each route for field names):
    - `job`: `GET /api/jobs/:id` → `job.status` (`queued|running|done|failed`), `job.progress`, `job.result`/output file field, `job.error`.
    - `captioned`: `GET /api/render/captioned-video-status/:jobId` → `status`, `phase`, `percent`, `file`, `error`.
    - `story`: `GET /api/story/:id` → `project.status` (`rendering` → running; `done`; `error` → failed; `ready_to_render`/`generating_images`/`segmenting`/`transcribing` → running with `phase` = the status), `project.render.percent`, `project.render.outputPath`, `project.error`.
    - `timeline`: `GET /api/timeline/render/:jobId` → `status`, `phase`, `progress`, `publicUrl`/`file`, `error`.
    - `instrumental`: `GET /api/music/instrumental/:jobId` → `status`, `percent`, `resultFile`, `error`.
    - `publish`: `GET /api/social/youtube/publish/:jobId` → `job.status`, result URL, `job.error`.
  - `tools/jobs.js`: `jobs_list { limit?: 1..100 = 20 }`, `jobs_get { id }`, `jobs_retry { id }` (caps `renders: 1`), `jobs_wait { kind, id, projectId?, timeoutSec? }`.

- [ ] **Step 1: Write the failing normaliser tests** with one fixture payload per kind (copied from the route's actual response shape) asserting the handle; plus `waitForJob` returning at the first terminal poll, and returning the running handle at timeout (`sleep` stubbed, `timeoutSec: 1`).
- [ ] **Step 2: Write the failing tool tests** over MCP: `jobs_list` on an empty store returns `[]`; `jobs_wait` with an unknown kind → `fail("BAD_KIND", …)`; `timeoutSec: 500` is clamped to 90 (assert via a seam that records the clamp).
- [ ] **Step 3: Run** → fail. **Step 4: Implement.** **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(mcp): jobs tools and jobs_wait with the first six status normalisers"`

---

### Task 10: Safe URL download and `POST /api/media/import-url`

**Files:**
- Create: `server/src/lib/safeDownload.js`
- Modify: `server/src/routes/media.js` (new route after `/upload-audio`), `server/src/lib/backgroundLimits.js` (export `MAX_INPUT_MB`), `server/src/routes/jobs.js:32` (import it from there)
- Test: `server/src/lib/safeDownload.test.js`, `server/src/routes/media.importUrl.test.js`

**Interfaces:**
- Produces:
  - `safeDownload.js`: `isPublicAddress(ip: string): boolean` (false for 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, ::1, fc00::/7, fe80::/10, and IPv4-mapped forms); `downloadPublicUrl(url, destPath, { maxBytes, maxRedirects = 3, timeoutMs = 60_000, lookup = dns.promises.lookup, fetchImpl }): Promise<{ bytes, contentType, finalUrl }>` — rejects non-http(s) with `Error("URL_SCHEME")`; resolves the host with `lookup`, refuses private results with `Error("URL_PRIVATE")`, connects with `redirect: "manual"` and re-runs the check on each `Location` up to `maxRedirects` (`Error("URL_REDIRECTS")`), streams to `destPath` aborting past `maxBytes` with `Error("URL_TOO_LARGE")`; pins the address by passing a custom `agent`/`dispatcher` whose `lookup` returns the resolved address (node-fetch v3 accepts an `agent` with a `lookup` option).
  - `media.js`: `POST /api/media/import-url { url, kind: "audio"|"video"|"image" = "audio", filename? }` → downloads to `req.ctx.outputDir` as `user-<kind>-<uuid>.<ext>` (ext from the content type, falling back to the URL's), then for audio runs `processReceivedAudio` (same response as `/upload-audio`); for video runs the same validation `/upload-source-video` does; for image the `imageSniff` check; errors map: `URL_PRIVATE`/`URL_SCHEME`/`URL_REDIRECTS` → 400, `URL_TOO_LARGE` → 413, download failure → 502.
  - `backgroundLimits.js`: `export const MAX_INPUT_MB = Number(process.env.MAX_INPUT_MB || 200)`.

- [ ] **Step 1: Write the failing download tests** (local `http.createServer` fixtures; `lookup` stubbed to return `127.0.0.1` for a fake public name only when the test wants a reachable server; otherwise assert refusals):

```js
test("isPublicAddress: private ranges false, 8.8.8.8 true, ::ffff:10.0.0.1 false", ...)
test("a private host is refused before connecting", ...)                 // URL_PRIVATE
test("a redirect to 127.0.0.1 is refused", ...)                          // first hop public (stubbed), Location http://127.0.0.1:<port>/x → URL_PRIVATE
test("more than 3 redirects is refused", ...)
test("a body over maxBytes is aborted and the file removed", ...)        // URL_TOO_LARGE, dest does not exist
test("a good download reports bytes and content type", ...)
```

- [ ] **Step 2: Write the failing route test** (mount `media.js` with a stub `req.ctx`; stub `downloadPublicUrl` through an exported seam `_setDownloader`): a 1-minute WAV fixture imports and answers like `/upload-audio`; `kind: "image"` with a text file → 400; `URL_TOO_LARGE` → 413.
- [ ] **Step 3: Run** → fail. **Step 4: Implement.** **Step 5: Run** → pass; `npm test --prefix server` green.
- [ ] **Step 6: Commit** — `git commit -m "feat(media): import a file from a public URL with address, redirect and size guards"`

---

### Task 11: Media tools and the coverage test

**Files:**
- Create: `server/src/mcp/tools/media.js`, `server/src/mcp/coverage.test.js`
- Test: `server/src/mcp/tools/media.test.js`

**Interfaces:**
- Produces: `media_list { kind: "audio"|"video" }` → `GET /api/media/audio-list|video-list`; `media_import_url { url, kind?, filename? }` → Task 10 route; `media_trim { ... }` → `POST /api/media/trim` (read the body shape); `transcribe { audioPath, ... }` → `POST /api/transcribe` (read the body shape; this counts the app's `render` quota already, no cap bucket).
- `coverage.test.js`: parses `server/index.js` for every `app.use("/api/<name>", …)` mount, collects every tool's declared `routes: string[]` (add `routes` to `ToolDef`: the `/api/<name>` prefixes it calls), and fails listing any mounted prefix with no tool and not in `EXCLUDED = ["auth","agent-keys","admin","access-requests","billing","stems-worker","firebase","abi","postiz","issues","mcp"]`. **In this slice the test is expected to fail for the feature routers not yet mapped**, so it ships with a `PENDING` list (every creation router) that shrinks as slices 2–4 land, and asserts `PENDING` only contains routers that are still unmapped (so a mapped router must be removed from `PENDING`).

- [ ] **Step 1: Write the failing tool tests** over MCP with `/api/media` mounted in the helper: `media_list` returns an array; `media_import_url` with a private URL returns `fail("URL_PRIVATE", …)` text.
- [ ] **Step 2: Write the coverage test** as described.
- [ ] **Step 3: Run** → fail. **Step 4: Implement** `tools/media.js`, add `routes` to the system and jobs tools, and the coverage test's `PENDING` list. **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `git commit -m "feat(mcp): media tools and a coverage test that keeps every feature mapped"`

---

### Task 12: The guide (`docs/mcp.md`) and the Help page section

**Files:**
- Create: `docs/mcp.md`
- Modify: `client/src/pages/HelpPage.tsx` (new section "Connect an agent"), `client/vite.config.ts` (nothing unless `?raw` import outside root is blocked; then add `server.fs.allow: [path.resolve(__dirname, '..')]`)
- Test: `client/src/pages/__tests__/HelpPage.agents.test.tsx`

**Interfaces:**
- `docs/mcp.md` sections, in this order and with these headings: `# Connect an agent to BibleFuel`; `## What it is` (endpoint URL `https://biblefuel.tiwaton.co.uk/api/mcp`); `## Get a key`; `## Connect Hermes Agent`, `## Connect Codex`, `## Connect Claude Code` (the three snippets from the spec, verbatim, with `<your key>`); `## How a call works` (tool result shape, `structuredContent`, errors as `CODE: message`); `## Waiting for jobs` (the handle, `jobs_wait`, 90-second cap, call again); `## Getting media in` (`media_import_url`, then a worked `curl` for `POST /api/media/upload-audio` with a JWT); `## Pipelines` (one ordered tool list per feature; slice 1 writes the ones whose tools exist and marks the rest "coming"); `## Quotas and daily caps` (the five buckets, defaults, `MCP_CAP_REACHED`, `QUOTA_EXCEEDED`); `## What a key can never do`; `## Troubleshooting` (401, 403, `PUBLISH_NOT_ALLOWED`, `MCP_CAP_REACHED`, timeouts).
- Help page: `import guide from '../../../docs/mcp.md?raw'` rendered with `react-markdown` + `remark-gfm` inside a `Card title="Connect an agent"`; headings and code blocks styled with the existing typography tokens (no new colours).
- The server's `biblefuel://guide` resource reads the same file (`path.resolve(SERVER_ROOT, "../docs/mcp.md")`); confirm `server/Dockerfile` copies `docs/` into the image, and add the `COPY` if it does not.

- [ ] **Step 1: Write the failing client test**: renders `HelpPage` and finds the heading "Connect an agent" and the text "bearer_token_env_var".
- [ ] **Step 2: Run** `npx vitest run src/pages/__tests__/HelpPage.agents.test.tsx` → fails.
- [ ] **Step 3: Write `docs/mcp.md`** and the Help page section. **Step 4: Run** the test → passes; `npm run build --prefix client` succeeds (`tsc -b` included).
- [ ] **Step 5: Server test**: in `transport.test.js` add "the guide resource returns the markdown" (`client.readResource({ uri: "biblefuel://guide" })` text starts with `# Connect an agent`). Run → pass.
- [ ] **Step 6: Commit** — `git commit -m "docs: the agent guide, served on the Help page and as the biblefuel://guide resource"`

---

### Task 13: Connected agents card

**Files:**
- Create: `client/src/lib/agentKeysApi.ts`, `client/src/components/ConnectedAgentsCard.tsx`
- Modify: `client/src/pages/SettingsPage.tsx:293` (insert after `<PlanAndUsageCard />`)
- Test: `client/src/components/__tests__/ConnectedAgentsCard.test.tsx`

**Interfaces:**
- `agentKeysApi.ts`: `listAgentKeys(): Promise<{ endpoint: string; ceilings: Caps; keys: AgentKey[] }>`, `createAgentKey(name): Promise<{ key: AgentKey; plain: string }>`, `updateAgentKey(id, patch: { publishAllowed?: boolean; caps?: Partial<Caps> })`, `revokeAgentKey(id)`, `listAgentActivity(params): Promise<ActivityEntry[]>`, `activityCsvUrl(params): string`; types `AgentKey = { id, name, prefix, createdAt, lastUsedAt, publishAllowed, caps, usage: Record<bucket, { used, limit, remaining }> }`.
- `ConnectedAgentsCard`: `Card title="Connected agents"`; rows: name, prefix, created, last used (reuse `timeAgo` from `WebhookConnectCard` by moving it to `client/src/lib/timeAgo.ts`), a labelled switch "This key may publish" (label text exactly that; helper text "The agent will post to your connected accounts as you."), today's usage as `used / limit` per bucket, Revoke (confirm dialog, same pattern as the webhook card's delete); "Create key" opens a modal asking for a name, then shows the plain key once in a read-only `Input` with a Copy button and the line "Copy it now. It will not be shown again."; below the list: the endpoint URL and the three snippets from `docs/mcp.md` with `<your key>` (never a real key), each with Copy; a "Recent activity" disclosure listing the last 50 entries (tool, outcome, time) and an "Export CSV" link.

- [ ] **Step 1: Write the failing tests** (mock `../../lib/agentKeysApi`):

```ts
it('creates a key and shows it once', ...)                        // after create: plain visible; after closing: not in the document; list shows prefix only
it('toggles publish consent', ...)                                // switch calls updateAgentKey(id, { publishAllowed: true })
it('revokes after confirm', ...)
it('never renders a real key in the snippets', ...)               // snippets contain "<your key>" and not the plain value
it('shows cap usage per bucket', ...)                             // "3 / 10"
```

- [ ] **Step 2: Run** → fail. **Step 3: Implement.** **Step 4: Run** → pass; `npx vitest run` and `npm run build --prefix client` green.
- [ ] **Step 5: Design gate** (section 11 of `~/.claude/standards/DESIGN_QUALITY_STANDARD.md`): run it on the card; record any unchecked item as unverified in the commit message.
- [ ] **Step 6: Commit** — `git commit -m "feat(settings): Connected agents card with keys, consent, caps and activity"`

---

### Task 14: End-to-end check with a real agent, then PR

**Files:**
- Modify: `docs/superpowers/plans/2026-10-23-mcp-agent-access-slice-1.md` (tick the manual checks)

- [ ] **Step 1: Start the dev server from the worktree** on a port other than the main checkout's (`PORT=5061`), create a key in Settings, and connect Claude Code: `claude mcp add --transport http biblefuel-dev http://localhost:5061/api/mcp --header "Authorization: Bearer <key>"` then `claude mcp list` → connected.
- [ ] **Step 2: From that Claude Code session** run `whoami`, `capabilities`, `media_list`, `jobs_list`; confirm the activity view in Settings shows the four calls.
- [ ] **Step 3: Connect Hermes Agent** with the `config.yaml` snippet against the same server; run `whoami`; confirm it appears in the activity log with a distinct key.
- [ ] **Step 4: Flip the publish switch off and on**, confirm the two `key:publish_*` events in the log.
- [ ] **Step 5: Open the PR** against `master` with `Closes #<issue>` (create the issue first: `gh issue create --title "MCP agent access, slice 1: endpoint, keys, caps, log, guide" --label enhancement`), wait for the Codex review, fix or rule on every finding, reply on the PR. Do not merge without the operator's go-ahead.

---

## Self-review notes

- Spec coverage: transport, keys, consent, caps, activity log, loopback dispatch, backstop guard, `whoami`/`capabilities`, jobs + `jobs_wait`, media import with guards, coverage test, guide in three places, Settings card, tests — all have tasks. The Admin "Agent activity" tab, the remaining normalisers and every feature tool are slices 2–4 by the spec.
- Names used across tasks: `requireAgentKeyOrJwt`, `refuseAgentCalls`, `signInternalToken`, `findByPlainKey`, `updateKey`, `charge`, `capsSummary`, `logActivity`, `readActivity`, `createApi`/`Api.call`, `ok`/`fail`, `buildServer`, `createMcpRouter`, `ToolDef.requires/publish/caps/routes`, `JobHandle`, `waitForJob`, `downloadPublicUrl`, `MAX_INPUT_MB` — consistent.
- Review Focus tests are placed: 1 → Task 6, 2 → Task 10, 3 → Task 4, 4 → Task 2, 5 → Task 3.
