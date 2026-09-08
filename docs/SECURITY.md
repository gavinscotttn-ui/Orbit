# Security and privacy

Orbit holds passports, bank transactions, medical notes, and children's school
records. This document says exactly what protects them, and — more importantly —
exactly what does not, because a security document that only lists strengths is
a marketing document.

Everything claimed here is implemented in the code and, where marked, exercised
by a test. Everything not implemented is listed as not implemented.

---

## 1. Orbit makes no network requests

This is the headline, and it is enforced rather than intended.

The block lives in one file, [`src/main/security.ts`](../src/main/security.ts),
so it can be audited in one sitting.

| Layer | What it does |
| --- | --- |
| `session.webRequest.onBeforeRequest` | Cancels **every** request whose scheme is not `file:`, `devtools:`, `blob:`, `data:` or `chrome-extension:`. There is no host allow-list to get wrong, because no host is allowed. |
| `session.setProxy({ mode: 'direct' })` | Refuses to resolve a proxy for anything. |
| Content-Security-Policy | Sent as a real **response header**, not a `<meta>` tag, so injected markup cannot override it. `connect-src 'none'` forbids `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` outright. `default-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`, `base-uri 'none'`. |
| Chromium switches | `disable-background-networking`, `disable-component-update`, `disable-domain-reliability`, `no-pings`, `disable-sync`, `disable-breakpad`, and `MediaRouter`/`DialMediaRouteProvider` disabled — so the browser engine itself does not chatter. |
| Counter | Every blocked request is counted and the last one recorded, shown in **Settings → Privacy**. An honest zero, not an assertion. |

There is no telemetry, no analytics, no crash reporting, no update check, and no
remote fonts or stylesheets. The interface uses the operating system's own
fonts; `src/renderer/index.html` carries a comment explaining why there is no
`<link>` to a font CDN, so nobody helpfully adds one later.

**Verified.** The end-to-end run (`tests/e2e/smoke.mjs`) executes `fetch()` from
inside the running renderer and asserts it is refused, loads a remote image and
asserts it fails, and checks that `app.info` reports `networkEnabled: false`.

**The exception, stated plainly.** *Building* Orbit uses the network: `npm
install` fetches packages and electron-builder downloads the Electron binary.
That is the build machine, not the shipped application. Nothing downloaded at
build time can open a socket at runtime, because the block is installed before
the first window exists.

---

## 2. No account, ever

There is no sign-in, no cloud service, no licence check and no account to
create. Orbit opens a folder on your disk. If you delete the application, your
records are still in that folder; if you delete the folder, they are gone, and
Orbit will not have a copy.

---

## 3. The renderer is not trusted

Standard current Electron guidance, applied in full:

* `contextIsolation: true`
* `nodeIntegration: false`
* `sandbox: true`
* `webviewTag: false`, `enableRemoteModule` not used (it no longer exists)
* Preload exposes exactly three functions: an allow-listed `invoke`, an
  allow-listed event `on`, and `pathForDroppedFile` (which is
  `webUtils.getPathForFile` and nothing else)

Navigation is refused: `will-navigate`, `will-redirect`, `setWindowOpenHandler`
and `will-attach-webview` are all blocked, on every `WebContents` as it is
created — not only on the main window. The renderer shows Orbit and cannot be
made to show anything else.

External links are never opened automatically. A link goes through the
`app.openExternal` message, which accepts only `https:`, `http:` and `mailto:`
and hands it to the user's own browser. `file:` links and custom schemes are
refused, because both can launch arbitrary things.

Permissions are denied by default — camera, microphone, geolocation, MIDI, USB,
serial, HID, Bluetooth pairing, the lot. Desktop notifications are the single
conditional permission, and only when the user has turned them on in Settings
for that machine.

---

## 4. The IPC surface

Every message goes through **one** channel, `orbit:invoke`, with a name from a
fixed allow-list (`src/shared/contracts/ipc.ts`). Each name has a zod schema in
the main process; a message that does not match its schema is rejected before
any handler runs.

Handlers return a result envelope (`{ ok: true, data }` or
`{ ok: false, error }`) rather than throwing across the boundary, so a failure
becomes a sentence the interface can show rather than a stack trace or a hung
promise. SQLite errors are translated into plain English by `describeSqlError`
rather than leaked verbatim.

---

## 5. Path safety

Any path that reaches the filesystem from a message goes through
`VaultPaths.resolveInside` ([`src/main/vault/paths.ts`](../src/main/vault/paths.ts)),
a single choke point that resolves the path and refuses anything landing outside
the open vault. `../` traversal, absolute paths, and symlink escapes are
rejected there rather than in each caller.

Attachments are **content-addressed**: stored as
`attachments/<aa>/<bb>/<sha256>.<ext>`. The user's original filename is a column
in the database, never a path on disk. This removes an entire class of problem
at once — Windows reserved names (`CON`, `NUL`, `LPT1`), characters legal on
macOS and illegal on Windows, case collisions on case-insensitive volumes,
Unicode normalisation differences between HFS+/APFS and NTFS, and filename-based
traversal. It also deduplicates identical files for free.

The one exception is the portable pointer file (`orbit-portable.txt`), which is
allowed to name a path outside the vault — it is deliberate local configuration
written by whoever set up the drive, not input arriving from elsewhere. See
[PORTABLE.md](PORTABLE.md).

---

## 6. Encryption — **not implemented**

**Orbit does not encrypt your vault.** The database is a plain SQLite file and
the attachments are plain files. Anyone with access to the folder can read them.

This is stated in the application itself (Settings → Privacy carries the same
notice), in the manifest (`"encryption": "none"`), and here. It would be very
easy to write "your data is encrypted at rest" and mean "the disk might be".
Orbit does not do that.

**What to do instead, today:** turn on full-disk encryption — FileVault on
macOS, BitLocker on Windows. That protects a stolen laptop better than anything
an application can do on its own, because it also covers the swap file,
temporary files, and the operating system's own caches, which an
application-level scheme does not.

**The design for when it is built.** The `VaultEncryption` type already carries
`'sqlcipher-not-implemented'` as a deliberate marker rather than a promise. An
encrypted vault would need:

1. **SQLCipher**, which is a native module — reintroducing per-architecture
   builds that `node:sqlite` currently avoids. That trade-off is the reason it
   is not in this version, not an oversight.
2. **A key derived from a passphrase** with a modern memory-hard KDF (Argon2id),
   the parameters and salt stored in the manifest so any build can open the
   vault.
3. **Attachment encryption too.** An encrypted database beside a folder of
   plaintext receipts is theatre.
4. **A recovery key, explained honestly.** A 24-word or Base32 recovery key
   shown once, at creation, with the true sentence attached: *if you lose both
   the passphrase and the recovery key, your data is unrecoverable — there is no
   reset, because there is no server, and that is the point.* Any product that
   offers to "reset your password" for an end-to-end encrypted store can read
   your data.
5. **Key material in the OS keychain** (macOS Keychain / Windows Credential
   Manager) via `safeStorage`, per device, never in the vault — with the
   understanding that this makes the *convenience of not retyping* device-bound,
   while the vault itself stays portable.

Until all five exist and are tested, the answer to "is it encrypted?" is **no**.

---

## 7. Automatic locking

**Settings → This computer only → Lock the vault after.** After the chosen
period without pointer, keyboard, wheel or window-focus activity, Orbit closes
the vault: the database is closed, the lock file released, and the opening
screen returns with nothing from your records on it.

Because there is no passphrase (see §6), locking **hides and releases** — it
does not encrypt. The setting says so in the interface rather than implying
more. It is a per-device preference, since it describes the machine you are
sitting at rather than the vault.

---

## 8. Secrets and logging

* The log is written to the per-device application folder, never into the vault,
  and **redacts as it writes** ([`src/main/log.ts`](../src/main/log.ts)):
  anything after `password`/`passphrase`/`secret`/`token`/`api key`/`recovery`
  becomes `[redacted]`, email addresses become `[email]`, and 13–19 digit runs
  become `[card]`. Redaction happens at the logger, not at each call site, so a
  future careless log line is still covered.
* Record *values* are never logged. Failures log the operation and the error
  class, not the data.
* Orbit stores no credentials of its own, because it has no account and no
  provider connections. There are no API keys to protect. The
  password-manager-style fields in the Digital Life area store **notes about**
  accounts (which manager, which email, whether 2FA is on) and Orbit does not
  invite you to paste passwords into them.

---

## 9. Destructive actions

* Deleting a record takes a **before-snapshot** into the activity log first, and
  the toast offers **Undo**, which restores it. Tested in
  `tests/integration/records.test.ts`.
* Restoring a backup takes a **fresh backup of the current state first**, then
  stages the restore to a temporary file and renames it into place. A restore
  that goes wrong therefore leaves you with two recoverable states rather than
  none.
* A schema migration takes a **mandatory pre-migration backup** before the first
  statement runs. If the backup cannot be written, the migration does not start.
* Destructive actions confirm first, through a modal that traps focus and
  returns it, is dismissible by <kbd>Esc</kbd>, and — for the genuinely
  irreversible ones, such as emptying a vault — requires the user to **type a
  word** rather than click a button they have learned to click
  (`requireWord` in [`ui.tsx`](../src/renderer/src/components/ui.tsx)).
  Confirmations are in-app modals, not native OS dialogs; choosing files and
  folders uses the real native pickers, so Orbit never asks you to type a path.

---

## 10. Data you can take away

Everything is exportable: **CSV or JSON per record type**, the whole vault as a
folder you can copy, and backups that are plain SQLite files openable by any
SQLite tool.
The schema is documented in [VAULT-FORMAT.md](VAULT-FORMAT.md), including how to
read a vault **without Orbit at all**. There is no lock-in, and nothing is
stored in a proprietary container.

---

## 11. Imports are treated as hostile

Statement import is **CSV only** — OFX and QIF are recognised as attachment
types and can be stored, but there is no parser for them, and one has not been
half-written and left in. The CSV reader is a small, explicit one (quoted
fields, embedded commas and newlines) with no formula evaluation of any kind:
a cell beginning `=`, `+` or `@` is a string, because it is. Values are coerced
to their declared types and rejected if they will not coerce, a preview is shown
before anything is written, and duplicates are detected before the commit.
Imported text is rendered as text; it never becomes markup.

Export is guarded in the other direction. A cell that a spreadsheet would run as
a formula — one beginning `=`, `+`, `@`, a tab, a carriage return, or a minus
that is not part of a number — is prefixed with an apostrophe on the way out, so
a CSV you export and send to somebody else cannot execute in their copy of
Excel. Ordinary negative amounts are left exactly as they are, because a finance
export is full of them. Both directions are tested in `tests/unit/csv.test.ts`. Attachment text
extraction handles plain text and CSV only — PDF extraction is marked
`unsupported` rather than attempted with a parser that would then be a new
attack surface.

---

## 12. Concurrency and corruption

A lock file with a heartbeat prevents two copies of Orbit writing to one vault.
Reentrancy is keyed on an instance id rather than a process id, so two sessions
on one machine still conflict correctly. A lock older than five minutes is
reported as stale and can be taken over **deliberately**, with a dialog, never
silently.

SQLite runs in WAL mode with `foreign_keys = ON` and a busy timeout. Backups use
SQLite's **online backup API**, not a file copy — copying a live database is the
classic way to produce a file that looks fine and is not. Before a transfer,
`wal_checkpoint(TRUNCATE)` folds the log back into the database so the folder is
self-contained. See [TRANSFER.md](TRANSFER.md).

---

## 13. Known limitations

Listed because they are real, not because they are comfortable.

| Limitation | Detail |
| --- | --- |
| No encryption at rest | §6. Use FileVault or BitLocker. |
| No passphrase | Anyone at your unlocked computer can open Orbit and read the vault. Auto-lock (§7) reduces the window; it does not close it. |
| Unsigned builds | No signing credentials exist in this repository, so Gatekeeper and SmartScreen will warn. See [PACKAGING.md](PACKAGING.md) §5. |
| Backups live inside the vault | Convenient and portable, but a backup in the same folder does not survive losing the folder. Copy the vault somewhere else as well. |
| No audit of dependencies | The dependency tree is small and unremarkable, but no formal supply-chain audit or SBOM has been produced. |
| Not penetration tested | Nobody has attacked this application. The design follows current Electron guidance; that is not the same as having been tested by a hostile expert, and this document will not imply it has been. |
| Windows and macOS behaviours unverified | All testing was on Linux. See [PACKAGING.md](PACKAGING.md) §9. |
