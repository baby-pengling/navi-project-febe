# Navi Desktop (Electron)

Electron port of the Swift app in `../NaviProject`, for macOS and Windows. The backend
is unchanged: the same Supabase project, tables, RPCs, and Edge Functions (`../supabase/`).

## Setup

```bash
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same values as Secrets.xcconfig)
npm install
npm run dev            # development, with hot reload
```

## Builds

```bash
npm run dist:mac       # release/Navi-<version>.dmg
npm run dist:win       # release/Navi Setup <version>.exe (NSIS)
```

Code signing is not configured yet. Unsigned builds still run, but macOS Gatekeeper and
Windows SmartScreen will warn.

## Structure

| Path | Swift counterpart |
|---|---|
| `src/main/index.ts` | AppKit layer: main window, floating widget window (`FloatingWidgetController`), `navi://` deep links (`onOpenURL`), menu (`AccountCommands`), session storage (Keychain → `safeStorage`) |
| `src/preload/index.ts` | The `window.navi` bridge between renderer and main |
| `src/renderer/src/data/` | `Main/Data/` (`NaviBackend.swift`, `NaviEdgeServices.swift`) and `AppSessionStore.swift` |
| `src/renderer/src/models/` | The `*Model.swift` `ObservableObject`s, as `Observable` subclasses (`useModel` re-renders on change) |
| `src/renderer/src/components/` | `DesignSystem/` and shared views (todo rows, timeline, panels) |
| `src/renderer/src/screens/` | Onboarding, main window tabs, dialogs, and the floating widget (`#widget`) |

## Google sign-in

The Google consent opens in the system browser (the Swift app used
`ASWebAuthenticationSession`) and comes back through `navi://auth-callback`, the redirect URL
already allowed in Supabase. The app registers the `navi` scheme itself at launch; installed
builds also declare it in `electron-builder.yml`.

## Known differences from the Swift app

- The floating widget still shows sample data, as in Swift.
- Date pickers use the system date and time inputs inside a popover instead of the graphical
  macOS calendar.
- The widget is moved by dragging its title row (the Swift panel moved by its background).
