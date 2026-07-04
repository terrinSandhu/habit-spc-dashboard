# Data Dictionary

## variables.csv

| Column | Meaning |
|---|---|
| variable_id | Stable machine-readable ID. Used to join entries and chart data. |
| label | Display name in the UI. |
| source_label | Original imported variable label. Keep this for traceability. |
| category | Editable grouping shown in entry and dashboard filters. |
| type | numeric, binary, proportion, count, minutes, grams, kcal, or text. |
| unit | Display unit. |
| goal_daily_avg | Goal/centerline used for scoring and SPC goal bands. |
| goal_sigma | Starter sigma around the goal. |
| lcl | Lower control/spec/goal band. Currently computed as goal - 2 × sigma. |
| ucl | Upper control/spec/goal band. Currently computed as goal + 2 × sigma. |
| higher_is_better | TRUE, FALSE, or blank. Blank means "within band" scoring. |
| active | TRUE means show in app; FALSE means retained historically but hidden by default. |
| entry_source | manual, meal_rollup, or computed. |
| required_for_score | TRUE means included in the aggregate habit calendar score. |
| spc_enabled | TRUE means chart on dashboard. |
| created_at | Date variable was created/imported. |
| retired_at | Date variable was retired, if inactive. |
| notes | Free-text notes. |

## entries.csv

| Column | Meaning |
|---|---|
| entry_id | Unique daily entry row ID. |
| date | Entry date. |
| timestamp | Save/update timestamp. |
| variable_id | Variable being recorded. |
| value | Numeric or binary value. |
| note | Optional shared note. |
| created_at | Creation timestamp. |
| updated_at | Last update timestamp. |

## meals.csv

| Column | Meaning |
|---|---|
| meal_id | Unique meal row ID. |
| date | Meal date. |
| time | Meal time. |
| meal_name | User-entered meal name. |
| kcal | Calories. |
| protein_g | Protein grams. |
| fat_g | Fat grams. |
| carbs_g | Carbohydrate grams. |
| meal_type_auto | breakfast, lunch, dinner, or snack_late based on time. |
| macro_category_auto | high_protein, high_carb, high_fat, light, balanced, or uncategorized. |
| notes | Optional notes. |
| created_at | Creation timestamp. |
| updated_at | Last update timestamp. |

## daily_rollups.csv

Computed from meals.

| Column | Meaning |
|---|---|
| date | Date. |
| calories | Total daily meal kCal. |
| protein | Total daily protein grams. |
| carbs | Total daily carbs grams. |
| fat | Total daily fat grams. |
| meal_count | Number of meals logged. |
| high_protein_meals | Count of meals auto-tagged high_protein. |
| high_carb_meals | Count of meals auto-tagged high_carb. |
| high_fat_meals | Count of meals auto-tagged high_fat. |
| balanced_meals | Count of meals auto-tagged balanced. |
| light_meals | Count of meals auto-tagged light. |
| updated_at | Last rollup computation timestamp. |
