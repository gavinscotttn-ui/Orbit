# Packaging Orbit

What the build produces, what it needs, and — the part most packaging documents
skip — what has **not** been verified.

All packaging is configured in [`electron-builder.yml`](../electron-builder.yml)
and driven by the scripts in `package.json`.

---

## 1. The one thing to be clear about

The **application** is per-platform and per-architecture. A macOS build will not
run on Windows. An Apple Silicon build is not an Intel build. There is no single
executable that runs everywhere, and this project will not imply otherwise.

The **vault** is not per-platform. One vault folder opens in any Orbit build, on
either operating system, on either processor family. That is what "portable"
means here, and it is proven by a test that physically moves a vault
(`tests/integration/vault.test.ts`) and by the end-to-end run, which moves a
vault on disk and reopens it in the packaged renderer.

---

## 2. Prerequisites

| Need | Why |
| --- | --- |
| Node.js 20.19+ or 22.12+ | Vite 7 and electron-vite 5 require it |
| npm | lockfile is `package-lock.json` |
| A machine of the target OS **or** a cross-build with the caveats below | see §4 |

There are **no native modules**. Persistence uses `node:sqlite`, which is built
into the Electron runtime, so there is nothing to compile per architecture, no
node-gyp, no Python toolchain, and no prebuilt binary to go missing. This is a
large part of why packaging here is unusually boring, which is the correct
temperature for packaging.

`npmRebuild: false` in the builder config states that explicitly.

### Build-time network access

The **application** makes no network requests, ever (see
[SECURITY.md](SECURITY.md)). The **build** does: `npm install` fetches packages
from the registry and electron-builder downloads the Electron binary and, for
Windows targets, the NSIS toolchain. These are entirely separate things. Nothing
downloaded at build time causes the shipped app to open a socket; the network
block is installed at the Electron session level before the first window exists.

---

## 3. Commands

```bash
npm install
npm run verify          # typecheck + unit/integration tests + build
npm run pack:dir        # unpacked app in release/<version>/ — fastest sanity check
npm run dist:mac        # dmg + zip, arm64 and x64
npm run dist:win        # NSIS installer + portable exe, x64
npm run dist:all        # both (see the cross-building caveat)
npm run dist:mac:arm64  # single architecture
npm run dist:mac:x64
npm run dist:win:portable
```

Artefacts land in `release/<version>/`.

| Target | Artefact | Notes |
| --- | --- | --- |
| macOS arm64 | `Orbit-<version>-arm64.dmg`, `.zip` | Apple Silicon |
| macOS x64 | `Orbit-<version>-x64.dmg`, `.zip` | Intel |
| Windows x64 | `Orbit-<version>-x64-nsis.exe` | installer, per-user by default, install location changeable |
| Windows x64 | `Orbit-<version>-portable.exe` | portable, see [PORTABLE.md](PORTABLE.md) |

---

## 4. Cross-building, honestly

* **macOS artefacts can only be built on macOS.** The dmg tooling and `codesign`
  are macOS-only. `dist:mac` on Linux or Windows will not produce a usable dmg.
* **Windows artefacts can be built on macOS or Linux**, because electron-builder
  downloads a portable NSIS. Signing them cannot: `signtool` needs Windows, or a
  cloud signing service.
* `dist:all` therefore assumes a macOS host, and even then produces *unsigned*
  Windows binaries.

---

## 5. Code signing and notarisation — not done

This repository contains no signing credentials, and none are fabricated.

**macOS.** `hardenedRuntime: true` and the entitlements file
(`build/entitlements.mac.plist`) are configured, so a signed build will work
when an identity is present in the keychain (`CSC_LINK` / `CSC_KEY_PASSWORD` or
a Developer ID in the login keychain). Without one, electron-builder produces an
**unsigned, un-notarised** app. Gatekeeper will quarantine it: the user sees
"Orbit is damaged and can't be opened" or "cannot be opened because the
developer cannot be verified", and must right-click → Open, or clear the
quarantine attribute manually.

There is **no `afterSign` notarisation hook**. One that silently did nothing
would be worse than its absence, so it is absent. Adding notarisation later
means: an Apple Developer account, `@electron/notarize` as a dev dependency, an
`afterSign` script, and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
`APPLE_TEAM_ID` in the environment.

The entitlements deliberately do **not** include
`com.apple.security.network.client` or `.network.server`, nor camera or
microphone. An app that never uses the network should not ask for permission to.

**Windows.** No certificate is configured, so the NSIS installer and the
portable exe are unsigned and SmartScreen will warn on first run. Signing needs
a code-signing certificate and `CSC_LINK` / `CSC_KEY_PASSWORD`, or
`WIN_CSC_LINK`.

---

## 6. Application icons — not present

`resources/` and `build/` contain no icon assets, so electron-builder falls back
to the default Electron icon. Shipping a placeholder icon and calling it
branding would be dishonest; adding the real one is a one-file change:

* `build/icon.icns` (macOS, 1024×1024 source)
* `build/icon.ico` (Windows, multi-resolution)
* `build/icon.png` (512×512, used as a fallback)

electron-builder picks these up from `buildResources: build` with no config
change. Until then the app's window title and interface are correct; only the
dock/taskbar icon is Electron's.

---

## 7. What the uninstaller does not do

`deleteAppDataOnUninstall: false`. Removing the application is not permission to
remove somebody's records. Vaults live wherever the user chose them to and are
never touched by install or uninstall. Uninstalling removes the application and
the small per-device preferences file only (see
[VAULT-FORMAT.md](VAULT-FORMAT.md), "What travels, and what does not").

---

## 8. Updates

There is no auto-updater and no update check. `publish: null`. An application
that promises never to touch the network cannot also phone home for a new
version. Updating means downloading a new build and running it against the same
vault folder; the schema migration path handles the rest
([VAULT-FORMAT.md](VAULT-FORMAT.md)).

---

## 9. What still needs checking on a real machine

Everything in this project was developed and tested on **Linux**. The unit and
integration tests are platform-independent logic and pass. The end-to-end run
drives the genuinely built application under Electron. But the following are
**configured, not verified**, and a simulated path test is not the same as
running on Windows:

### macOS (Apple Silicon and Intel, separately)

- [ ] `npm run dist:mac` completes and produces both dmgs
- [ ] The app launches from `/Applications` and from a dmg-mounted volume
- [ ] Gatekeeper behaviour on an unsigned build is as described in §5
- [ ] `distributionDirectory()` resolves to the folder **containing** `Orbit.app`,
      never inside the bundle (`src/main/vault/portable.ts`)
- [ ] Creating a vault in `~/Documents`, in `~/Desktop`, and on an external
      volume all work; the folder picker returns the path you expect
- [ ] A vault on a case-insensitive APFS volume behaves (the case-fold guard in
      `src/shared/domain/ids.ts` exists precisely for this)
- [ ] Notification permission prompt appears only after enabling it in Settings
- [ ] Dark mode follows the system setting and the manual override wins
- [ ] Native menu, ⌘-key shortcuts, and the dock-icon reopen behaviour

### Windows x64

- [ ] `npm run dist:win` completes; the NSIS installer installs per-user
- [ ] SmartScreen behaviour on an unsigned build
- [ ] The portable exe runs from a USB stick and finds an adjacent
      `Orbit Vault` folder ([PORTABLE.md](PORTABLE.md))
- [ ] A vault on a drive letter (`E:\Orbit Vault`) and on a UNC path
      (`\\server\share\Orbit Vault`) — UNC is expected to work for reads but
      **is not a supported live location**, see [TRANSFER.md](TRANSFER.md)
- [ ] Removing the USB stick while a vault is open fails safely with a readable
      message and does not silently write elsewhere
- [ ] Long paths beyond 260 characters
- [ ] Filenames that are legal on macOS and illegal on Windows survive a
      transfer — this is why attachments are content-addressed rather than
      stored under their original names
- [ ] Uninstall leaves vaults untouched

### Both

- [ ] Create a vault on one platform, open it on the other, confirm attachments
      still resolve — the acceptance criterion that matters most

Record the results. Until somebody does, [FEATURE-STATUS.md](FEATURE-STATUS.md)
will continue to say "Platforms actually tested: Linux only", because it is
true.
