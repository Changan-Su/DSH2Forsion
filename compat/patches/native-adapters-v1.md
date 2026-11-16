# Native view and execution adapter v1

This is an explicit compatibility layer, not an upstream feature claim. Task Board
`@linxin666/dsh-client-ui-task-board@0.4.7` is Apache-2.0. DSH ui-layout
`0.2.1-rc.2` is MIT. License copies are adjacent; installed originals, their LICENSE,
existing NOTICE and verified original JavaScript are retained. Installation appends
a dated change notice. Unknown versions, hashes, prior edits or anchors fail closed.

## Install and boot

Call `prepareNativeCompatibility({profileDir,log})` after plugin installation and
before each trial/main sidecar boot. Only this isolated profile is modified. Atomic
file replacement preserves pnpm shared hardlinks. The installer is idempotent and
repairs interrupted installation only from separately hash-verified originals.

Bundle `src/native-client/host.mjs` into the bridge's `native-adapters.js`. Copy
`src/native-client/client.js` to its `native-client.js`. Bridge package metadata must
export `./client` and declare a web `dsh.client` depending on renderer/layout/connection.
Call `installNativeAdapters(ctx,{invoke})` during bridge activation. Its `openView({panelKey})`
returns a sidecar-relative path; expose that operation only through the private bridge.
`invoke(op,payload)` talks to the authenticated engine callback with JSON
`{adapter:'task-board',version:1,op,payload}`. It never carries caller-selected user IDs.

The dedicated document reuses the official Web entry and public clientModules
graph/bundle API. Its guarded per-view transport selects a different component in
the existing layout root registration, preserving child declaration ownership,
store and services. It renders the requested public slot using the adapter's
whitelisted descriptor. It neither renders nor hides the DSH AppFrame. Arbitrary
URL module names are not accepted. Task Board is the first descriptor, not a claim
that every nested slot can already be rendered without its declaring parent.

## Execution and navigation

The optional runner factory receives the original pure `promptText` helper.
The deployment waits for the explicit adapter service, preventing a startup race
from falling back to a DSH agent runner. Native context supplies real projects,
models and navigation. Default/empty mode means Tangu; explicit DSH presets are
rejected. DSH `/goal` is not silently represented as Tangu goal execution.

Before dispatch, the runner binds `forsion-task:<executionId>` in the original
ledger. This is an opaque external reference, never a DSH session. The engine owns
durable execution-to-Tangu IDs, request idempotency and user ownership. `launch`
returns actual Tangu IDs. `list`, `status`, `cancel` and `openSession` accept
`executionId` or the opaque reference. Resume accepts only an existing native
execution reference. A new execution has its own request ID even when it reuses
an owned Tangu session.

Operations: `context`, `launch`, `status`, `list`, `cancel`, `createWorkspace`,
`openSession`. Browser access is restricted to context/cancel/workspace/navigation
through a separate view-scoped token; it never receives either host's API secret.
Navigation succeeds only after the native renderer acknowledges opening the real
Tangu session. Cancellation calls the real engine and the normal runner inspection
settles the original ledger. It does not forge a column move or external outcome.
Unknown/unreadable state is never success. Approval remains Tangu's native policy.

The original Task Board CRUD, card rendering, storage and host polling stay intact.
Advanced DSH-only goal/team/model-parser features are not claimed as mapped by this
adapter. The public detail slot adds native open/cancel controls without copying
the board implementation.

## Additional panel descriptors

`skills-manager` selects the original Skills Manager 1.2.24 `main` entry with key
`skills-manager`. Its explicit native open works independently of its saved
sidebar-entry preference; that preference is never changed. `git-graph` selects
the added public `main` entry `forsion-git-graph` in Git Graph 0.4.7. This entry
renders the package's unchanged GraphDialog with its original Git API injection,
using the verified native cwd. It maps the original close/back action to native
navigation. This does not claim native blank-session branch/worktree-chip support.

Both clients explicitly wait for the native context service. Approved real
directories are registered through public `workspaceRegistry.create`, so original
third-party workspace-membership gates remain authoritative. No DSH Session is
created to pretend that a Tangu conversation belongs to it. Panel package version,
artifact hashes, activation and slot selection are checked before serving a view.
The original settings/graph UI and project-skill operations remain upstream code.

## Checks

`node tests/check-native-client.mjs` checks the pure contract and authorization.
Set `DSH2FORSION_TASKBOARD_PACKAGE` to an untouched 0.4.7 package and
`DSH2FORSION_ROOT` to the rc.2 runtime to additionally validate original hashes,
parse transformed artifacts, mount HTML/bundle transport, preserve shared inodes,
license/NOTICE and repeated installation. These checks do not execute third-party
code or call a model; real UI and model acceptance remain separate.
