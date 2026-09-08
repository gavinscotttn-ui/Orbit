<div align="center">

# Orbit

**Life orbits around it.**

A private, offline-first personal life management application for macOS and
Windows. One folder holds everything; that folder is yours and it travels.

</div>

---

## What you can run right now

Everything below is built, working and exercised by tests. Nothing here is a
mock-up or a placeholder.

```bash
git clone <this repository>
cd Orbit
npm install
npm run dev          # the real application, in development
```

On first launch Orbit asks you to do one of three things, and does nothing until
you choose:

1. **Create a new vault** — pick any folder. That folder is now your data.
2. **Open an existing vault** — including one that moved, or one on a USB stick.
3. **Open the demonstration vault** — an isolated, clearly-badged vault full of
   invented records, in its own folder, never mixed with anything real.

Start with the demonstration vault. It seeds five connected workflows that show
what "connected" means here:

* a **car** with insurance, an MOT date, a service history, fuel logs and a
  receipt — with the total cost of ownership adding itself up from the records
* a **purchase** with its receipt, warranty, and a return deadline that appears
  on Today before it expires
* a **trip** with bookings, a packing list, tasks and a budget
* a **household bill** that shows up both in Today (because it is due) and in
  Money (because it is money)
* a vault that can be **prepared for transfer**, moved, and reopened somewhere
  else with every attachment still resolving

---

## What it does

| Area | What lives there |
| --- | --- |
| **Today** | What actually needs you: bills due, MOT and insurance expiry, warranties running out, prescriptions, birthdays, tasks, servicing due by mileage, people you have not spoken to in a while |
| **Plan** | Calendar, tasks, projects, goals, routines, waiting-on |
| **Money** | Accounts, transactions, budgets, bills and subscriptions, debts and loans, payday and UK tax, net worth, statement import |
| **Life** | The areas you switch on: vehicles, home, documents and insurance, health, family, pets, food, work and learning, travel, relationships, hobbies, digital life |
| **Inbox** | Quick capture, and anything waiting to be filed |

Plus global search across everything, a command palette, and a settings screen
that tells you the truth about what is and is not implemented.

### Keyboard

| | |
| --- | --- |
| <kbd>⌘/Ctrl</kbd> + <kbd>K</kbd> | Command palette |
| <kbd>⌘/Ctrl</kbd> + <kbd>F</kbd> or <kbd>/</kbd> | Search everything |
| <kbd>⌘/Ctrl</kbd> + <kbd>⇧</kbd> + <kbd>N</kbd> | Quick capture |

---

## Two things worth knowing before you start

### 1. It never touches the network

Not "we don't collect analytics" — **every network request is cancelled at the
Electron session level**, the content-security policy forbids `connect-src`
outright, and Chromium's own background networking is switched off. There is no
account, no telemetry, no crash reporting, no update check, and no remote fonts.
Settings → Privacy shows you a live count of blocked requests, which is normally
zero because nothing tries.

The end-to-end test suite proves it: it runs `fetch()` inside the real
application and asserts that it fails.

Building Orbit uses the network (npm, and the Electron binary). Running it does
not. See [docs/SECURITY.md](docs/SECURITY.md).

### 2. Your vault is not encrypted

Orbit does not encrypt your data, does not claim to, and says so in the
application itself. Turn on **FileVault** (macOS) or **BitLocker** (Windows) —
that protects a stolen laptop better than anything an application can do alone.
The design for a future encrypted vault, and why it is not in this version, is
in [docs/SECURITY.md](docs/SECURITY.md) §6.

---

## The vault

One folder. You choose where. It looks like this:

```
My Orbit Vault/
├── orbit-vault.json          the manifest: id, format version, name
├── data/orbit.sqlite         every record
├── attachments/aa/bb/<sha256>.pdf
├── backups/                  automatic and manual, plain SQLite files
├── exports/
├── preferences/portable.json settings that travel with the vault
└── README.txt                written by Orbit, for whoever finds this folder
```

* **Nothing anywhere stores an absolute path.** Attachments are addressed by
  content hash, so the vault opens correctly after moving to a different folder,
  a different drive letter, a different user account, or a different operating
  system.
* **Attachment names cannot break on another platform.** Files are stored under
  their hash; your original filename is a value in the database. Windows
  reserved names, characters that are legal on macOS and illegal on Windows,
  and case collisions all stop being possible.
* **Nothing critical lives outside the vault.** No registry keys, no
  `localStorage`, nothing in the install directory. The only per-machine file
  holds theme override, text size, auto-lock and the recent-vaults list.
* **Orbit never silently falls back.** If your vault folder is missing,
  read-only, or on a drive you just unplugged, it says so and stops. It will not
  quietly write your records somewhere else.

Full details: [docs/VAULT-FORMAT.md](docs/VAULT-FORMAT.md) ·
[docs/TRANSFER.md](docs/TRANSFER.md) · [docs/PORTABLE.md](docs/PORTABLE.md)

---

## Building and packaging

```bash
npm run typecheck     # TypeScript, strict, both processes
npm run test          # unit + integration
npm run verify        # typecheck + test + build
npm run build         # production bundles into out/

npm run pack:dir      # unpacked app — quickest way to see a real build
npm run dist:mac      # dmg + zip for Apple Silicon and Intel
npm run dist:win      # NSIS installer + portable exe, x64
npm run test:e2e      # build, then drive the real app with Playwright
```

**The application is per-platform and per-architecture; the vault is not.** A
macOS build will not run on Windows, and an Apple Silicon build is not an Intel
build — but one vault folder opens in all of them.

macOS artefacts must be built on macOS. Nothing here is code-signed or
notarised, because there are no credentials in this repository to sign with, so
Gatekeeper and SmartScreen will warn on first run. What that means, and exactly
what still needs checking on real macOS and Windows machines, is in
[docs/PACKAGING.md](docs/PACKAGING.md).

---

## Honesty about testing

| | |
| --- | --- |
| Unit and integration tests | passing (`npm run test`) |
| End-to-end checks against the built app | passing (`npm run test:e2e`) |
| Platforms actually tested | **Linux only** |

macOS and Windows behaviour — the `.app` bundle, Gatekeeper, the NSIS
installer, the portable executable, drive letters, UNC paths — is **configured
but unverified**. A simulated path test is not the same as running on Windows,
and no document in this repository will pretend otherwise. The checklist is in
[docs/PACKAGING.md](docs/PACKAGING.md) §9.

Current counts, and an honest grade for every feature in the specification —
including the ones that are not built — are in
[docs/FEATURE-STATUS.md](docs/FEATURE-STATUS.md).

---

## Built on

Electron · React 19 · TypeScript · Vite · **`node:sqlite`** (the SQLite built
into the Electron runtime — no native modules, nothing to compile per
architecture) · zod · vitest · Playwright.

The finance module is built on the **Amethyst Money** prototype: what was
carried over, what changed and why is documented in
[docs/AMETHYST.md](docs/AMETHYST.md).

---

## Documentation

| | |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is put together, for somebody changing it |
| [SECURITY.md](docs/SECURITY.md) | The network block, the threat model, and what is *not* protected |
| [VAULT-FORMAT.md](docs/VAULT-FORMAT.md) | The on-disk format, the manifest, migrations, reading a vault without Orbit |
| [TRANSFER.md](docs/TRANSFER.md) | Backing up, restoring, moving to another computer |
| [PORTABLE.md](docs/PORTABLE.md) | Running from a USB stick |
| [PACKAGING.md](docs/PACKAGING.md) | Building installers, signing, and what needs real-machine testing |
| [SHARING.md](docs/SHARING.md) | Why "assigned to" is a label and not a permission |
| [FEATURE-STATUS.md](docs/FEATURE-STATUS.md) | Every feature, graded honestly |
