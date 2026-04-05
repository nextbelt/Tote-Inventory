# Tote Inventory Management App

A React application for managing storage totes and their contents with photo support and Supabase cloud sync.

## Features

- Create, edit, and delete totes with custom names
- Assign totes to 26 shelf positions (A1-G5) with visual grid and table views
- Add items to totes with photo upload support
- Search across totes, positions, and items
- Real-time sync via Supabase
- Offline localStorage fallback
- Responsive design for desktop and mobile

## Tech Stack

| Layer    | Technology                               |
|----------|------------------------------------------|
| UI       | React 18, Tailwind CSS, Lucide React     |
| Build    | Vite                                     |
| Backend  | Supabase (PostgreSQL, Storage, Realtime) |
| Fallback | Browser localStorage                     |

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (see [SUPABASE_SETUP.md](SUPABASE_SETUP.md))

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (see `.env.example`):
   ```env
   VITE_SUPABASE_URL=your_project_url
   VITE_SUPABASE_ANON_KEY=your_anon_key
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

The app runs at **http://localhost:3000**.

### Commands

| Command           | Description              |
|-------------------|--------------------------|
| `npm run dev`     | Start development server |
| `npm run build`   | Build for production     |
| `npm run preview` | Preview production build |
| `npm run lint`    | Run ESLint               |

## Project Structure

```
src/
├── components/     # Reusable UI (ErrorBoundary, SearchBar, ToteCard)
├── hooks/          # React hooks (useTotes — state + CRUD)
├── lib/            # Supabase client initialisation
├── pages/          # Page components (Grid, Detail, Form)
├── services/       # Data access layer (toteService)
├── utils/          # Constants and validation helpers
├── App.jsx         # App shell and view routing
├── main.jsx        # Entry point
└── index.css       # Global styles
```

## Shelf Layout

```
Row 1:  A1  B1  --  --  --  F1  G1
Row 2:  A2  B2  --  --  --  F2  G2
Row 3:  A3  B3  --  --  --  F3  G3
Row 4:  A4  B4  C4  D4  E4  F4  G4
Row 5:  A5  B5  C5  D5  E5  F5  G5
```

## Data Storage

Data is stored in Supabase (PostgreSQL) with real-time sync. When Supabase is unavailable the app falls back to browser localStorage. Images are uploaded to Supabase Storage with base64 encoding as fallback.
