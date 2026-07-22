# Dive Trip Planner — setup

## What each file does
- `index.html` — the page structure GitHub Pages serves to visitors
- `styles.css` — all visual styling
- `app.js` — all the logic: login, saving data to Supabase, drag-reorder, weather auto-fetch
- `schema.sql` — run this once in Supabase to create your database tables

## 1. Set up Supabase
1. Create a project at supabase.com (free tier is fine to start).
2. Go to the **SQL Editor**, paste in the entire contents of `schema.sql`, and run it. This creates every table and turns on Row Level Security, so each person can only see their own trips.
3. Go to **Authentication > Providers** and make sure Email is enabled (it is by default).
4. Go to **Project Settings > API**. Copy the **Project URL** and the **anon public key**.

## 2. Connect the app to your Supabase project
Open `app.js` and near the very top, replace:
```js
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```
with the values you copied. The anon key is safe to expose in a public file — it's designed to be used from browsers, and Row Level Security (from schema.sql) is what actually protects the data, not secrecy of this key.

## 3. Deploy to GitHub Pages
1. Create a new GitHub repository and push `index.html`, `styles.css`, and `app.js` to it (schema.sql doesn't need to be in the repo — it's only for Supabase's SQL editor, but it's fine to keep it there for your own reference).
2. In the repo, go to **Settings > Pages**, set the source branch to `main` (or wherever you pushed), and save.
3. GitHub gives you a URL like `https://yourusername.github.io/repo-name/` — that's your live app.

## 4. Try it
Visit your GitHub Pages URL, create an account (any email/password), and you should land in the app with a first trip already created for you.

## About the weather auto-fetch
When you type a destination name into "Compare Destinations" and click away from the field, the app looks up its coordinates automatically (via Open-Meteo's free geocoding service) and then fetches conditions data:
- If your target date is within about 16 days, it pulls an actual forecast.
- Otherwise, it pulls the same calendar week from last year as a "typical conditions" estimate.

Results are cached on that row (`weather_fetched_at`), so it won't re-call the API every time you open the app — only on first fetch, or when you click "Refresh conditions."

**Note:** Open-Meteo's exact API parameters occasionally change as they add features. If a weather fetch ever silently returns no data, it's worth checking their current docs at open-meteo.com to confirm the parameter names in `app.js` (search for `sea_surface_temperature` and `temperature_2m_mean`) still match.

## The drag-and-drop fix
Each card's title bar has a small `⠿⠿` grip icon on the left. Dragging is only possible from that icon — dragging anywhere else on a card, including inside a notes box, just selects text like a normal text field. This is configured in `app.js` via SortableJS's `handle: '.drag-handle'` option.

## If you outgrow single-user editing
The schema already includes a `trip_collaborators` table that isn't used yet. Adding read-only trip sharing later means writing a small invite UI and a few more Supabase calls — it won't require changing the tables you already have data in.
