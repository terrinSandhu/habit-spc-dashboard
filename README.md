# Personal SPC Habit + Meal Dashboard

Static GitHub Pages dashboard with:

- PIN gate 
- Daily habit/parameter entry
- Meal entry: meal name, kCal, protein, fat, carbs
- Meal rollups into Calories, Protein, Carbs, Fat
- SPC/goal-band charts using `goal ± 2 × goal_sigma`
- GitHub-style aggregate habit calendar
- Overlayed trend lines
- Overlayed histograms with density curves
- Correlation table
- Rule-based recommendations
- Editable variable/spec-limit table
- CSV-backed storage

## Files

```text
index.html
assets/
  app.js
  charts.js
  github-sync.js
  styles.css
data/
  variables.csv
  entries.csv
  meals.csv
  daily_rollups.csv
```

## Default PIN

```text
2002
```

The source code stores only the SHA-256 hash of `2002`, not the raw PIN.

Important: this is not real security. It is a lightweight privacy curtain for a static GitHub Pages site.

## Data model

### `data/variables.csv`

Source of truth for variables/habits/spec limits.

Key columns:

- `variable_id`: stable machine ID
- `label`: display name
- `source_label`: original label imported from `spc-questions.xlsx`
- `category`: editable category
- `type`: numeric, binary, proportion, count, minutes, grams, kcal, text
- `goal_daily_avg`: daily target/centerline
- `goal_sigma`: starter sigma
- `lcl`: lower goal/spec band
- `ucl`: upper goal/spec band
- `active`: TRUE/FALSE
- `entry_source`: manual, meal_rollup, computed
- `required_for_score`: TRUE/FALSE
- `spc_enabled`: TRUE/FALSE

Variables are never deleted for traceability. Retire by setting `active` to `FALSE`.

### `data/entries.csv`

Manual daily entries.

### `data/meals.csv`

Meal-level entries.

### `data/daily_rollups.csv`

Daily meal totals computed from `meals.csv`.

## GitHub sync

The app can read/write CSV files through GitHub's Contents API.

You will enter these in the app:

- owner
- repo
- branch
- data path, usually `data`
- GitHub token

The token is stored only in your own browser localStorage, not committed to the repo.

## Local testing

Because browsers restrict `fetch()` from local `file://` pages, test locally with a static server:

```bash
cd habit-spc-dashboard
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Libraries loaded by CDN

- Plotly.js for charts
- PapaParse for CSV parsing/writing
