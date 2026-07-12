# Garage Totes

A mobile-first web app for finding, adding, and moving everything stored in
our garage totes. Designed for one-handed iPhone use, installable from
Safari via **Share → Add to Home Screen**.

## What it does

- **Three garage walls** — swipe (or tap tabs) between the Left wall, Front
  wall, and Right wall. The front wall mirrors the real garage: two wooden
  tote racks (columns A/B and F/G, five levels), a pegboard + workbench in
  the middle, and floor totes (C/D/E). A plan-view mini-map shows which wall
  you're facing.
- **"Where is it?" search** — forgiving search (typos, plurals, partial
  words) across tote names, positions, and items. Results show the photo,
  quantity, and a location path like `Front wall · Left rack · Level 3`.
  **Show me** jumps to the right wall and pulses the exact slot.
- **Fast capture** — add an item from the tote page with one text field, an
  optional camera photo (compressed on-device before upload), and Enter.
- **Quantities** — +/− steppers on every item ("used one" / "restocked"),
  with an out-of-stock state. Saves are debounced and optimistic.
- **Move & delete with Undo** — move a tote by tapping its new slot on a
  visual picker; destructive actions get a snackbar Undo.
- **Offline-aware** — cloud data is mirrored locally for offline browsing;
  writes fail loudly instead of silently diverging.
- **Build your own side walls** — "Edit shelves" on the Left/Right wall sets
  how many shelf levels each wall has (synced to every device). A shelf that
  still holds a tote can't be removed.
- **Dark mode** — follows the phone's appearance automatically, with a
  manual sun/moon override in the header.

## Tech Stack

| Layer    | Technology                               |
|----------|------------------------------------------|
| UI       | React 18, Tailwind CSS, Lucide React     |
| Build    | Vite                                     |
| Backend  | Supabase (PostgreSQL, Storage, Realtime) |
| Fallback | Browser localStorage (no-Supabase mode)  |
| Tests    | Vitest + React Testing Library           |

## Getting Started

1. Install dependencies: `npm install`
2. Create a `.env` (see `.env.example`) with your Supabase URL + anon key.
   Without one the app runs in local, on-device-only mode.
3. `npm run dev` — the app runs at **http://localhost:9000**.

### Commands

| Command           | Description                    |
|-------------------|--------------------------------|
| `npm run dev`     | Start development server       |
| `npm run build`   | Build for production           |
| `npm run preview` | Preview production build       |
| `npm run lint`    | Run ESLint                     |
| `npm test`        | Run the Vitest suite once      |
| `npm run test:watch` | Run tests in watch mode     |

## Garage model

The garage is described as data, not markup, in
[`src/utils/constants.js`](src/utils/constants.js): three walls, each a list
of fixtures (`rack`, `workbench`, `wallShelf`) that own slot positions.

```
Front wall  A1–A5, B1–B5 (left rack) · C4–E5 (workbench floor) · F1–F5, G1–G5 (right rack)
Left wall   LW1–LW5 (shelf levels)
Right wall  RW1–RW5 (shelf levels)
```

Position strings are stable database IDs — never rename them. The side-wall
shelf counts are user-editable in the app (stored as a hidden settings row
in the `totes` table, so they sync across devices with no extra schema).
The front wall is fixed physical geometry; to model a new fixture there
(e.g. the high shelf above the racks), add it to the wall config in
`constants.js` — rendering, search paths, and the move picker pick it up
automatically.

## Project Structure

```
src/
├── components/     # ToteCard, GarageWalls, SearchBar/Results, Toast, ErrorBoundary
├── hooks/          # useTotes — state, realtime sync, position map
├── lib/            # Supabase client initialisation
├── pages/          # GridPage (garage), DetailPage (tote), FormPage (new/edit)
├── services/       # toteService — cloud/local storage, migration
├── test/           # Vitest setup + hermetic Supabase mock
└── utils/          # garage model, search, validation, image compression
```

## Data storage

One `totes` table (`database-setup.sql`): `id, name, position (unique),
items jsonb, timestamps`. Items are `{ id, name, image, qty }` — `qty` is
optional and defaults to 1, so older records need no migration. Photos live
in the `tote-images` storage bucket.

When Supabase is configured, reads mirror to a local cache for offline
browsing and failed writes surface an error (never a silent local fork).
Without Supabase configuration, everything stays in localStorage.
