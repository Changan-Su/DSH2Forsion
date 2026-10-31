# Session and context adapter boundaries

Audit date: 2026-10-31. This document distinguishes source compatibility from verified compression. The initial source audit downloaded packages without executing them; the later, explicitly scoped runtime acceptance below activates the fixed original Billion package in an isolated profile. Downloading a package, loading its tools, or completing ordinary inference does not establish compression quality.

## Fixed source artifacts

The public npm package is **billion-context@0.1.201**, repository `ranxianglei/billion-context`. `dsh-billion-context@0.1.201` returned npm E404. Its package exports (`package.json:7–13`) select `dist/agent/dsh-native.js` for the root/DSH entry.

| Package | Official npm artifact | SHA-256 |
| --- | --- | --- |
| billion-context@0.1.201 | https://registry.npmjs.org/billion-context/-/billion-context-0.1.201.tgz | D4D7DF3D862DF84F5EE4F33BE535ED6EC9527D7F34341E18280DD33D61893288 |
| dsh-context@0.73.2 | https://registry.npmjs.org/dsh-context/-/dsh-context-0.73.2.tgz | 6765A8B7C55604528AA1C21CD1B04CF3ADCD3ABEB7C69F37FF32E5D5F323F2B6 |
| @michengai/dsh-archive-manager@1.1.2 | https://registry.npmjs.org/@michengai/dsh-archive-manager/-/dsh-archive-manager-1.1.2.tgz | BBDE647CB0F37251D3617F66A7B34A82E5EAE980FCF911F062BC0942A891BA3E |

Local read-only reference extraction is under the workspace-root `.Temp/dsh-context-audit/`. The Billion source map's `sourcesContent` was extracted without executing its module. Source names below are the original map paths; the local copies are `billion-sources/154-dsh-native.ts`, `226-dsh-compaction-disable.ts`, and `248-native-intercept.ts`. `dsh-context-0.73.2-index.pretty.js` only reformats the published bundle using esbuild; its header pins upstream commit `2ee5c96c9d9f`. These local artifacts are reference evidence, not shipped application code.

## What Billion actually mounts

Billion's `src/agent/dsh-native.ts` does not install a provider-neutral `llm/stream` transform. It mounts tools and commands, obtains optional services, and patches global fetch:

- Lines 821–847: tool calls require `exec.agent.session.id` and forward that ID to the proxy.
- Lines 1015–1028: inference attribution reads `ctx.agents.currentInitiator().session.id`.
- Lines 519–546: model metadata comes first from that session's `requestHeader()`, otherwise the global default model.
- Lines 1574–1604: unattributed inference is refused by the takeover gate and goes directly upstream, **uncompressed**.
- Lines 1723–1749: only registered, attributed requests receive `x-bili-plugin-conversation` and model/window headers.
- Lines 1759–1849: fork adoption and incremental requests maintain request-specific identity and acknowledgement state.
- Line 1982: normal activation calls `installNativeFetchIntercept`; `src/agent/native-intercept.ts:707–711,934–1004` installs the global fetch interceptor and gates recognized model URLs.

It also uses an explicitly unstable seam: `src/agent/dsh-compaction-disable.ts:79–94` hooks Cordis `internal/config` to disable DSH preset compaction. This is not a stable public DSH context API and does not disable Tangu's own history compression.

### Implemented attribution substrate

`src/dsh-bridge/session-scope.js` provides `SessionScopePool` using the public DSH agent factory, workspace archive service, `runMaintenance`, session projections and `agents.withInitiator`. The latter's public contract is documented in the pinned official runtime's `@deepseek-ai/dsh-agent/lib/types/index.d.ts:229–241`.

The engine computes `sha256(JSON.stringify([authenticatedUserId, nativeSessionId]))`. Only this opaque 64-hex key and the separately validated cwd cross the bridge. Tangu `ToolContext` already supplies both IDs (`tangu-agent/src/tools/toolTypes.ts:11–14`). Hashing is identity minimization, not anonymization or authorization: the caller still authenticates and owns the source context.

One bridge-owned, archived agent is bound to one opaque session key and canonical cwd. Two native sessions in one directory do not share compression state. Existing saved metadata is resumed only after a successful public persistence `stat`; read failure does not create an empty replacement. A changed cwd is rejected until an explicit rebinding protocol exists. The helper never submits messages, wakes a model driver, mirrors native conversation history, or writes Tangu's database.

Public helper contract:

```js
const scopes = new SessionScopePool(ctx)
const identity = { sessionKey, cwd }
const agent = await scopes.get(identity, signal)

await scopes.withInitiator(identity, signal, async (agent, combinedSignal) => {
  // Consume the entire lazy stream inside this callback.
  for await (const chunk of ctx.llm.stream({ ...options, signal: combinedSignal })) {
    combinedSignal.throwIfAborted()
    await publish(chunk)
  }
})

await scopes.execute(identity, signal, async (agent, combinedSignal) => {
  return ctx.tools.execute({ ...execution, agent, signal: combinedSignal })
})
await scopes.dispose()
```

Inference and tools share one serial maintenance lane per identity. Tool calls open/close real maintenance turn boundaries for DSH approval audit. Inference establishes attribution without inventing DSH model request/history events. Disable aborts pending work, rejects late final results, waits for owned work and disposes handles. The streaming route must check the combined signal before each chunk publication, since publication happens inside its callback. A callback returning an unconsumed AsyncIterable is rejected.

**This substrate alone does not claim Billion compression support.** The inference route must still pass the exact source session identity, align tool execution with that identity, convey the actual selected model/window without a misleading global fallback, and specify how native compaction, reset and fork interact with the proxy's retained substrate. Do not synthesize a DSH request header or whole history merely to satisfy an observer.

### Required real validation before claiming support

- Run two Tangu sessions concurrently in the same cwd; inspect proxy evidence that each inference and each Billion tool uses the corresponding distinct opaque conversation ID.
- Force a real compression boundary with a known fact early in the conversation; prove that the proxy transformed the actual request and that a later real model correctly retrieves the fact. Save original history and effective outbound evidence; a successful ordinary response is insufficient.
- Switch models/windows, restart, cancel, reset and fork; verify state lineage and exact model metadata, with no cross-session adoption or silent loss of retained facts.
- Disable/reload during inference and tools; no stale response may publish or restore an old activation. Verify healthy recovery or an explicit visible failure, not a silent claim of compression.
- Preserve native approvals. The thin DSH attribution agent is not authorization for side effects or access to Tangu's private session history.

`tests/check-session-scope.mjs` uses an instrumented registry/ALS fixture to verify ownership and lifecycle. `tests/check-session-scope-live.mjs` additionally runs an isolated real DSH profile with the pinned runtime: actual agent factory, canonical session cwd, durable workspace archive, initiator attribution across async iteration, real tool execution and approval audit, pool disposal, pool reload and process-restart resume. The 2026-10-31 passing evidence is `.tmp/session-scope-live-5q2VgT/results.json` with `first.log`, `reload.log` and `restart.log`; local auth values are redacted. This verifies the public runtime seams without a model call. Neither test installs Billion or establishes third-party compression quality; native-route integration and real-model compression validation remain separate requirements.

### Actual automatic-compression acceptance: 2026-10-31

**Passed within the scope stated here.** `tests/check-billion-live.mjs` uses the real Tangu plugin model-source registration, the production DSH single-inference bridge and `SessionScopePool`, the original `billion-context@0.1.201`, and GPT 6 Luna. A test-only DSH provider calls Tangu's existing `streamOpenAiResponses` once; it does not start another agent loop. Billion's original fetch interception sees the real official Codex HTTPS endpoint in the same DSH process and its own proxy performs the automatic preflight summary. No summary was manually supplied.

The original package is installed with `--ignore-scripts`; normal, explicitly authorized plugin activation starts its local proxy. The fixture additionally checks the installed version and SHA-256 of `dist/agent/dsh-native.js` (`fe1d610014672bb50b8271e45e18c202b850d07a158999baac4f3e9f5a3db69e`). Config/data/cache/state XDG roots and temporary files stay under the isolated run directory. Automatic updates and proxy session persistence are disabled. Credentials are read/refreshed at the user's existing authorized location, never copied into the profile or evidence. The upstream guard records request bodies without HTTP headers and redacts encrypted replay content; it claims a bounded slot before allowing each actual upstream POST, including hidden summary calls.

Successful evidence: `.tmp/billion-live-23pKNJ/results.json`, `upstream-requests.json`, and `xdg/state/billion-context/bili.log`.

- The real proxy reports `pluginAgent=dsh`, `windowSource=plugin`, `fallback=false`, and the exact opaque native session identity. Both actual upstream requests originate from its child process, rather than a DIRECT fallback in the host.
- Its log records automatic preflight folding of one range, with the local estimate moving from 1,931 to 1,191 tokens. The status contains active tier-1 block `b1`.
- The proxy's primary-request log records approximately 7.9 KiB inbound and 5.1 KiB outbound. The captured final upstream body no longer contains the original 7,000-character obsolete briefing and retains the exact early fact.
- Real Luna answers `COBALT-0802635E` from that folded input. The final native model-source result reports authoritative usage of 957 input and 12 output tokens.
- The first captured upstream body (17,744 characters) is the **summary request including compression instructions**; the second (5,173 characters) is the final inference. Their ratio is not an original-context compression ratio. Cold-start accounting also logs `~0 tokens saved`; this is not used as proof either way. Active block state, actual forwarding evidence and the post-fold recall establish the bounded result.

The fixture advertises one fixed, conservative provider route and configures the public DSH default-model service to that exact same route. Billion therefore reads accurate matching model metadata through its public fallback. No `request/header`, assistant or user events are invented in the thin DSH attribution session; no private `requestHeader` method is replaced. The proxy's explicit test ceiling is 2,000 tokens, with effective input room of 1,500 after headroom. It does not misrepresent that test ceiling as the underlying model's full capacity.

The input is an explicitly synthetic history supplied to a native single-inference source fixture. It is not inserted into Tangu's or DSH's conversation database. This path intentionally does not run Tangu Historian/compaction, so the original early fact reaches Billion intact. The acceptance does **not** establish a product-wide mutual-exclusion policy between Tangu compaction and Billion, arbitrary dynamic model switching, restart/fork inheritance, image handling, or arbitrary context plugins. Those remain outside this result. Neither `dsh-context` nor archive-manager gains native-history support from it.

The authorized Billion phase ended at **four actual upstream requests total**, including the failed diagnostic attempts; no additional model requests were made:

| Evidence | Actual upstream requests | Result |
| --- | ---: | --- |
| `.tmp/billion-live-2qOEgN` | 1 | Original proxy attribution and raw fact recall passed, but the smaller briefing stayed below pressure and `blocks=[]`; explicitly **not** compression acceptance. |
| `.tmp/billion-live-Ab7hlV` | 1 | Automatic summary created a real fold, but the overly small effective input room of 1,125 tokens remained below the resulting 1,217-token estimate. The original proxy correctly rejected the final forwarding with 413. |
| `.tmp/billion-live-23pKNJ` | 2 | Automatic summary plus real post-fold Luna recall passed, with no third request attempted. |

Earlier fixture-only manifest/catalog/schema setup failures made zero upstream requests. Their retained setup reports are diagnostic failures, not counted as passing validation. The previous general model-source acceptance `.tmp/models-live-LRs3Bt` is a separate phase with its own two-call allowance; it verifies ordinary native tool approval/execution, final answering, usage, cancellation, disable and session isolation rather than Billion compression.

Reproduction command (each invocation incurs its own explicit real-model budget; do not rerun after an allowance is exhausted):

```powershell
$env:FORSION_AGENT = 'F:/MyFiles/Projects/Forsion-Root/.worktrees/genesis-dsh-skills/tangu-agent'
$env:DSH2FORSION_ROOT = 'C:/Users/Dream/AppData/Local/Temp/dsh2forsion-e2e-G3l22K/plugin-data'
$env:BILI_FIXTURE_UPSTREAM_LIMIT = '2'
node DSH2Forsion/tests/check-billion-live.mjs
```

## Other representative context packages

### dsh-context@0.73.2

Published bundle references (the local formatted copy has stable audit line numbers):

- Lines 654–837 consume request/header, request/context, assistant/attempt, tool/result and compaction events.
- Lines 1334–1383 read complete persistence events and restore/hydrate projections.
- Lines 1471–1524 expose detail by querying DSH sessions/projections.
- Lines 1753–1758 register configurable prompt prefix/suffix.
- Lines 1775–1788 register `agent/pre-step`.
- Lines 1953–1965 register session projection reducers.

Its static prompt contributions can cross the ordinary prompt bridge. Its context dashboard cannot describe Tangu sessions from a single inference call or the thin tool/attribution agent: that agent deliberately has no native conversation event history. Native statistics require a separate Tangu metrics adapter. Do not fabricate DSH request/assistant/compaction events to make the dashboard appear functional.

### @michengai/dsh-archive-manager@1.1.2

The original published `package/lib/workspace.js:341–348` requires `sessionPersistence`, `sessionProjectionCache` and storage services. Lines 948–983 delete DSH live sessions, projection caches, descendants and transcript directories. This is DSH-side session management. It is not permission or an implementation for deleting/repairing Tangu sessions. UI exposure must name the session domain accurately.

## Minimal future native context transform contract

A general adapter for projection-based plugins would need an owner-scoped provider receiving an immutable snapshot:

```ts
prepare({ sessionKey, requestId, revision, messages, system, tools,
          modelBudget, priorState, signal })
  => { projectedRequest, nextState, retainedMessageIds, diagnostics }
settle(requestId, outcome)
```

The host allocates identity; validates revision, tool-call/result pairing and retained-source references; records the accepted projection/state; and owns dispatch. Fork/reset are explicit lineage events. Disable revokes the activation and pending transforms. Plugins do not directly modify core history or the database. This is a proposed contract, not an existing transparent compatibility claim, and Billion's published fetch/proxy integration would still need its own explicit adapter.
