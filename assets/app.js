/* Main app logic for the Personal SPC Dashboard. */
(function () {
  const PIN_HASH_SHA256 = "6c94e35ccc352d4e9ef0b99562cff995a5741ce8de8ad11b568892934daee366"; // SHA-256("2002")
  const CACHE_KEY = "habitSpc.cachedData.v1";

  const VARIABLE_HEADERS = [
    "variable_id", "label", "source_label", "category", "type", "unit", "goal_daily_avg",
    "goal_sigma", "lcl", "ucl", "higher_is_better", "active", "entry_source",
    "required_for_score", "spc_enabled", "created_at", "retired_at", "notes"
  ];

  const ENTRY_HEADERS = [
    "entry_id", "date", "timestamp", "variable_id", "value", "note", "created_at", "updated_at"
  ];

  const MEAL_HEADERS = [
    "meal_id", "date", "time", "meal_name", "kcal", "protein_g", "fat_g", "carbs_g",
    "meal_type_auto", "macro_category_auto", "notes", "created_at", "updated_at"
  ];

  const ROLLUP_HEADERS = [
    "date", "calories", "protein", "carbs", "fat", "meal_count", "high_protein_meals",
    "high_carb_meals", "high_fat_meals", "balanced_meals", "light_meals", "updated_at"
  ];

  const state = {
    variables: [],
    entries: [],
    meals: [],
    rollups: [],
    loaded: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function cleanBool(value) {
    return String(value).trim().toLowerCase() === "true";
  }

  function toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function htmlEscape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function slugify(value) {
    return String(value || "new_variable")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_") || "new_variable";
  }

  function id(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function toast(message, timeout = 3200) {
    const el = $("toast");
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.add("hidden"), timeout);
  }

  function parseCsv(text) {
    if (!text || !text.trim()) return [];
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      console.warn("CSV parse warnings", parsed.errors);
    }
    return parsed.data;
  }

  function unparseCsv(rows, headers) {
    return Papa.unparse(rows, { columns: headers, newline: "\n" });
  }

  function normalizeVariable(v) {
    const out = { ...v };
    for (const h of VARIABLE_HEADERS) {
      if (out[h] === undefined || out[h] === null) out[h] = "";
    }
    out.variable_id = slugify(out.variable_id || out.label || out.source_label);
    out.label = out.label || out.source_label || out.variable_id;
    out.source_label = out.source_label || out.label;
    out.category = out.category || "Uncategorized";
    out.type = out.type || "numeric";
    out.unit = out.unit || "";
    out.goal_daily_avg = out.goal_daily_avg === "" ? "" : String(out.goal_daily_avg);
    out.goal_sigma = out.goal_sigma === "" ? "" : String(out.goal_sigma);
    out.lcl = out.lcl === "" ? "" : String(out.lcl);
    out.ucl = out.ucl === "" ? "" : String(out.ucl);
    out.active = out.active === "" ? "TRUE" : String(out.active).toUpperCase();
    out.entry_source = out.entry_source || "manual";
    out.required_for_score = out.required_for_score === "" ? "TRUE" : String(out.required_for_score).toUpperCase();
    out.spc_enabled = out.spc_enabled === "" ? "TRUE" : String(out.spc_enabled).toUpperCase();
    out.created_at = out.created_at || todayStr();
    return out;
  }

  function normalizeEntry(e) {
    const out = { ...e };
    for (const h of ENTRY_HEADERS) {
      if (out[h] === undefined || out[h] === null) out[h] = "";
    }
    return out;
  }

  function normalizeMeal(m) {
    const out = { ...m };
    for (const h of MEAL_HEADERS) {
      if (out[h] === undefined || out[h] === null) out[h] = "";
    }
    return out;
  }

  async function hashPin(pin) {
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(pin));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function handlePin() {
    const pin = $("pinInput").value.trim();
    const error = $("pinError");
    error.textContent = "";
    const hash = await hashPin(pin);
    if (hash === PIN_HASH_SHA256) {
      sessionStorage.setItem("habitSpcUnlocked", "true");
      unlockApp();
    } else {
      error.textContent = "Incorrect PIN.";
      $("pinInput").value = "";
      setTimeout(() => $("pinInput").focus(), 150);
    }
  }

  async function unlockApp() {
    $("pinGate").classList.add("hidden");
    $("appShell").classList.remove("hidden");
    if (!state.loaded) {
      await loadAppData();
      state.loaded = true;
    }
  }

  function lockApp() {
    sessionStorage.removeItem("habitSpcUnlocked");
    $("appShell").classList.add("hidden");
    $("pinGate").classList.remove("hidden");
    $("pinInput").value = "";
    $("pinInput").focus();
  }

  function saveCache() {
    const payload = {
      variables: state.variables,
      entries: state.entries,
      meals: state.meals,
      rollups: computeDailyRollups(),
      savedAt: nowIso()
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function fetchStaticCsv(filename) {
    const res = await fetch(`data/${filename}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load data/${filename}`);
    return res.text();
  }

  async function loadStaticFiles() {
    const [vars, entries, meals, rollups] = await Promise.all([
      fetchStaticCsv("variables.csv"),
      fetchStaticCsv("entries.csv"),
      fetchStaticCsv("meals.csv"),
      fetchStaticCsv("daily_rollups.csv")
    ]);

    state.variables = parseCsv(vars).map(normalizeVariable);
    state.entries = parseCsv(entries).map(normalizeEntry);
    state.meals = parseCsv(meals).map(normalizeMeal);
    state.rollups = parseCsv(rollups);
  }

  async function loadAppData() {
    setDefaultDates();
    hydrateSyncSettings();

    const cached = loadCache();
    if (cached && Array.isArray(cached.variables) && cached.variables.length) {
      state.variables = cached.variables.map(normalizeVariable);
      state.entries = (cached.entries || []).map(normalizeEntry);
      state.meals = (cached.meals || []).map(normalizeMeal);
      state.rollups = cached.rollups || [];
      $("syncStatus").textContent = `Loaded local cached data from ${cached.savedAt || "browser storage"}.`;
    } else {
      try {
        await loadStaticFiles();
        $("syncStatus").textContent = "Loaded starter CSVs from /data.";
      } catch (err) {
        console.error(err);
        $("syncStatus").textContent = "Could not load local CSVs. Start by loading from GitHub or checking the /data folder.";
        toast(err.message, 5000);
      }
    }
    renderAll();
  }

  function setDefaultDates() {
    $("entryDate").value = todayStr();
    $("mealDate").value = todayStr();
    const now = new Date();
    $("mealTime").value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  function hydrateSyncSettings() {
    const settings = GitHubSync.getSettings();
    $("ghOwner").value = settings.owner || "";
    $("ghRepo").value = settings.repo || "";
    $("ghBranch").value = settings.branch || "main";
    $("ghDataPath").value = settings.dataPath || "data";
    $("ghToken").value = settings.token || "";
  }

  function currentGhSettings() {
    return {
      owner: $("ghOwner").value.trim(),
      repo: $("ghRepo").value.trim(),
      branch: $("ghBranch").value.trim() || "main",
      dataPath: $("ghDataPath").value.trim() || "data",
      token: $("ghToken").value.trim()
    };
  }

  function fileMapFromState() {
    const rollups = computeDailyRollups();
    state.rollups = rollups;
    return {
      "variables.csv": unparseCsv(state.variables.map(normalizeVariable), VARIABLE_HEADERS),
      "entries.csv": unparseCsv(state.entries.map(normalizeEntry), ENTRY_HEADERS),
      "meals.csv": unparseCsv(state.meals.map(normalizeMeal), MEAL_HEADERS),
      "daily_rollups.csv": unparseCsv(rollups, ROLLUP_HEADERS)
    };
  }

  async function loadFromGitHub() {
    const settings = currentGhSettings();
    if (!settings.owner || !settings.repo) {
      toast("Add GitHub owner and repo first.", 4000);
      return;
    }
    GitHubSync.saveSettings(settings);
    const sync = new GitHubSync.GitHubCsvSync(settings);
    $("syncStatus").textContent = "Loading CSVs from GitHub...";
    try {
      const files = await sync.loadAll();
      state.variables = parseCsv(files["variables.csv"]).map(normalizeVariable);
      state.entries = parseCsv(files["entries.csv"]).map(normalizeEntry);
      state.meals = parseCsv(files["meals.csv"]).map(normalizeMeal);
      state.rollups = parseCsv(files["daily_rollups.csv"]);
      saveCache();
      renderAll();
      $("syncStatus").textContent = `Loaded CSVs from ${settings.owner}/${settings.repo}.`;
      toast("Loaded from GitHub.");
    } catch (err) {
      console.error(err);
      $("syncStatus").textContent = "GitHub load failed.";
      toast(err.message, 7000);
    }
  }

  async function saveToGitHub() {
    const settings = currentGhSettings();
    if (!settings.owner || !settings.repo || !settings.token) {
      toast("Owner, repo, and token are required to save to GitHub.", 5000);
      return;
    }
    GitHubSync.saveSettings(settings);
    const sync = new GitHubSync.GitHubCsvSync(settings);
    const fileMap = fileMapFromState();
    $("syncStatus").textContent = "Saving CSVs to GitHub...";
    try {
      await sync.saveAll(fileMap);
      saveCache();
      $("syncStatus").textContent = `Saved CSVs to ${settings.owner}/${settings.repo}.`;
      toast("Saved to GitHub.");
    } catch (err) {
      console.error(err);
      $("syncStatus").textContent = "GitHub save failed.";
      toast(err.message, 8000);
    }
  }

  function renderAll() {
    renderDailyForm();
    renderMealTab();
    renderDashboardFilters();
    renderVariableEditor();
    renderDashboard();
  }

  function activeVariables() {
    return state.variables.filter(v => cleanBool(v.active));
  }

  function manualVariables() {
    return activeVariables().filter(v => (v.entry_source || "manual") === "manual");
  }

  function variableById() {
    return Object.fromEntries(state.variables.map(v => [v.variable_id, v]));
  }

  function existingEntryFor(date, variableId) {
    return state.entries.find(e => e.date === date && e.variable_id === variableId);
  }

  function inputForVariable(v, existing) {
    const val = existing ? existing.value : "";
    const goal = v.goal_daily_avg !== "" ? `Goal: ${v.goal_daily_avg}${v.unit ? " " + v.unit : ""}` : "";
    if (v.type === "binary") {
      return `
        <select id="varInput-${htmlEscape(v.variable_id)}" data-variable-id="${htmlEscape(v.variable_id)}">
          <option value=""></option>
          <option value="1" ${String(val) === "1" ? "selected" : ""}>Yes / 1</option>
          <option value="0" ${String(val) === "0" ? "selected" : ""}>No / 0</option>
        </select>
        <small>${htmlEscape(goal)}</small>
      `;
    }
    const step = v.type === "count" || v.type === "minutes" || v.type === "kcal" ? "1" : "0.01";
    return `
      <input id="varInput-${htmlEscape(v.variable_id)}" data-variable-id="${htmlEscape(v.variable_id)}" type="number" step="${step}" value="${htmlEscape(val)}" placeholder="${htmlEscape(v.goal_daily_avg)}" />
      <small>${htmlEscape(goal)}</small>
    `;
  }

  function renderDailyForm() {
    const container = $("dailyForm");
    const date = $("entryDate").value || todayStr();
    const groups = new Map();

    for (const v of manualVariables()) {
      const cat = v.category || "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(v);
    }

    const html = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, vars]) => `
        <section class="category-card">
          <h3>${htmlEscape(cat)}</h3>
          ${vars.map(v => {
            const existing = existingEntryFor(date, v.variable_id);
            return `
              <div class="variable-input-row">
                <label>
                  ${htmlEscape(v.label)}
                  ${inputForVariable(v, existing)}
                </label>
              </div>
            `;
          }).join("")}
        </section>
      `).join("");

    container.innerHTML = html || `<p class="muted">No active manual variables. Add variables in the Edit tab.</p>`;
  }

  function saveDailyEntry() {
    const date = $("entryDate").value || todayStr();
    const note = $("entryNote").value.trim();
    const stamp = nowIso();
    let count = 0;

    for (const v of manualVariables()) {
      const el = document.querySelector(`[data-variable-id="${CSS.escape(v.variable_id)}"]`);
      if (!el || el.value === "") continue;

      const existing = existingEntryFor(date, v.variable_id);
      if (existing) {
        existing.value = el.value;
        existing.note = note;
        existing.updated_at = stamp;
        existing.timestamp = stamp;
      } else {
        state.entries.push(normalizeEntry({
          entry_id: id("e"),
          date,
          timestamp: stamp,
          variable_id: v.variable_id,
          value: el.value,
          note,
          created_at: stamp,
          updated_at: stamp
        }));
      }
      count++;
    }

    saveCache();
    renderAll();
    toast(`Saved ${count} daily values locally.`);
    $("syncStatus").textContent = "Local changes saved. Click GitHub Sync → Save CSVs to GitHub when ready.";
  }

  function mealTypeFor(time) {
    const hour = Number((time || "12:00").split(":")[0]);
    if (hour >= 4 && hour < 11) return "breakfast";
    if (hour >= 11 && hour < 16) return "lunch";
    if (hour >= 16 && hour < 22) return "dinner";
    return "snack_late";
  }

  function macroCategory(kcal, protein, fat, carbs) {
    const derived = protein * 4 + carbs * 4 + fat * 9;
    const denom = kcal > 0 ? kcal : derived;
    if (!denom || denom <= 0) return "uncategorized";
    if (denom <= 250) return "light";
    const pPct = (protein * 4) / denom;
    const cPct = (carbs * 4) / denom;
    const fPct = (fat * 9) / denom;
    if (pPct >= 0.30) return "high_protein";
    if (cPct >= 0.50) return "high_carb";
    if (fPct >= 0.40) return "high_fat";
    return "balanced";
  }

  function saveMeal() {
    const date = $("mealDate").value || todayStr();
    const time = $("mealTime").value || "12:00";
    const protein = toNum($("mealProtein").value) || 0;
    const fat = toNum($("mealFat").value) || 0;
    const carbs = toNum($("mealCarbs").value) || 0;
    let kcal = toNum($("mealKcal").value);
    if (kcal === null) kcal = Math.round(protein * 4 + carbs * 4 + fat * 9);

    const mealName = $("mealName").value.trim() || "Meal";
    const stamp = nowIso();

    state.meals.push(normalizeMeal({
      meal_id: id("m"),
      date,
      time,
      meal_name: mealName,
      kcal,
      protein_g: protein,
      fat_g: fat,
      carbs_g: carbs,
      meal_type_auto: mealTypeFor(time),
      macro_category_auto: macroCategory(kcal, protein, fat, carbs),
      notes: $("mealNotes").value.trim(),
      created_at: stamp,
      updated_at: stamp
    }));

    $("mealName").value = "";
    $("mealKcal").value = "";
    $("mealProtein").value = "";
    $("mealFat").value = "";
    $("mealCarbs").value = "";
    $("mealNotes").value = "";

    state.rollups = computeDailyRollups();
    saveCache();
    renderAll();
    toast("Meal saved locally.");
    $("syncStatus").textContent = "Local meal saved. Click GitHub Sync → Save CSVs to GitHub when ready.";
  }

  function computeDailyRollups() {
    const map = new Map();

    for (const meal of state.meals) {
      if (!meal.date) continue;
      if (!map.has(meal.date)) {
        map.set(meal.date, {
          date: meal.date,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          meal_count: 0,
          high_protein_meals: 0,
          high_carb_meals: 0,
          high_fat_meals: 0,
          balanced_meals: 0,
          light_meals: 0,
          updated_at: nowIso()
        });
      }
      const r = map.get(meal.date);
      r.calories += toNum(meal.kcal) || 0;
      r.protein += toNum(meal.protein_g) || 0;
      r.carbs += toNum(meal.carbs_g) || 0;
      r.fat += toNum(meal.fat_g) || 0;
      r.meal_count += 1;

      if (meal.macro_category_auto === "high_protein") r.high_protein_meals += 1;
      if (meal.macro_category_auto === "high_carb") r.high_carb_meals += 1;
      if (meal.macro_category_auto === "high_fat") r.high_fat_meals += 1;
      if (meal.macro_category_auto === "balanced") r.balanced_meals += 1;
      if (meal.macro_category_auto === "light") r.light_meals += 1;
    }

    return [...map.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => {
        const out = {};
        for (const h of ROLLUP_HEADERS) out[h] = r[h] ?? "";
        return out;
      });
  }

  function renderMealTab() {
    const date = $("mealDate").value || todayStr();
    const meals = state.meals.filter(m => m.date === date).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const totals = meals.reduce((acc, m) => {
      acc.kcal += toNum(m.kcal) || 0;
      acc.protein += toNum(m.protein_g) || 0;
      acc.fat += toNum(m.fat_g) || 0;
      acc.carbs += toNum(m.carbs_g) || 0;
      return acc;
    }, { kcal: 0, protein: 0, fat: 0, carbs: 0 });

    $("mealSummary").innerHTML = [
      ["Meals", meals.length],
      ["Calories", Math.round(totals.kcal)],
      ["Protein", `${Math.round(totals.protein)} g`],
      ["Fat", `${Math.round(totals.fat)} g`],
      ["Carbs", `${Math.round(totals.carbs)} g`]
    ].map(([label, value]) => `
      <div class="metric-card"><span class="muted">${label}</span><strong>${value}</strong></div>
    `).join("");

    $("mealsTable").innerHTML = `
      <thead>
        <tr>
          <th>Time</th><th>Name</th><th>kCal</th><th>Protein</th><th>Fat</th><th>Carbs</th><th>Auto category</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${meals.map(m => `
          <tr>
            <td>${htmlEscape(m.time)}</td>
            <td>${htmlEscape(m.meal_name)}</td>
            <td>${htmlEscape(m.kcal)}</td>
            <td>${htmlEscape(m.protein_g)}</td>
            <td>${htmlEscape(m.fat_g)}</td>
            <td>${htmlEscape(m.carbs_g)}</td>
            <td><span class="badge">${htmlEscape(m.meal_type_auto)}</span> <span class="badge">${htmlEscape(m.macro_category_auto)}</span></td>
            <td><button class="danger delete-meal" data-meal-id="${htmlEscape(m.meal_id)}">Delete</button></td>
          </tr>
        `).join("") || `<tr><td colspan="8" class="muted">No meals logged for this date.</td></tr>`}
      </tbody>
    `;

    document.querySelectorAll(".delete-meal").forEach(btn => {
      btn.addEventListener("click", () => {
        const mealId = btn.dataset.mealId;
        state.meals = state.meals.filter(m => m.meal_id !== mealId);
        state.rollups = computeDailyRollups();
        saveCache();
        renderAll();
        toast("Meal deleted locally.");
      });
    });
  }

  function buildDailyRows() {
    const rows = new Map();

    function ensure(date) {
      if (!rows.has(date)) rows.set(date, { date });
      return rows.get(date);
    }

    for (const e of state.entries) {
      if (!e.date || !e.variable_id) continue;
      ensure(e.date)[e.variable_id] = toNum(e.value);
    }

    const rollups = computeDailyRollups();
    for (const r of rollups) {
      const row = ensure(r.date);
      row.calories = toNum(r.calories);
      row.protein = toNum(r.protein);
      row.carbs = toNum(r.carbs);
      row.fat = toNum(r.fat);
      row.meal_count = toNum(r.meal_count);
      row.high_protein_meals = toNum(r.high_protein_meals);
      row.high_carb_meals = toNum(r.high_carb_meals);
      row.high_fat_meals = toNum(r.high_fat_meals);
    }

    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  function isSuccess(variable, value) {
    const v = toNum(value);
    if (v === null) return false;

    const goal = toNum(variable.goal_daily_avg);
    const lcl = toNum(variable.lcl);
    const ucl = toNum(variable.ucl);
    const higher = String(variable.higher_is_better).toLowerCase();

    if (variable.type === "binary") return v >= 1;
    if (higher === "false") return ucl === null ? goal === null ? v <= 0 : v <= goal : v <= ucl;
    if (higher === "true") {
      if (["sleep", "jk"].includes(variable.variable_id)) {
        return (lcl === null || v >= lcl) && (ucl === null || v <= ucl);
      }
      return lcl === null ? (goal === null ? true : v >= goal) : v >= lcl;
    }

    return (lcl === null || v >= lcl) && (ucl === null || v <= ucl);
  }

  function computeScores(dailyRows) {
    const vars = activeVariables().filter(v => cleanBool(v.required_for_score));
    const out = {};
    for (const row of dailyRows) {
      if (!row.date) continue;
      if (!vars.length) {
        out[row.date] = null;
        continue;
      }
      let success = 0;
      for (const v of vars) {
        if (isSuccess(v, row[v.variable_id])) success++;
      }
      out[row.date] = success / vars.length;
    }
    return out;
  }

  function renderDashboardFilters() {
    const categories = ["All", ...DashboardCharts.uniqueSorted(activeVariables().map(v => v.category || "Uncategorized"))];
    const oldCat = $("categoryFilter").value || "All";
    $("categoryFilter").innerHTML = categories.map(c => `<option value="${htmlEscape(c)}">${htmlEscape(c)}</option>`).join("");
    $("categoryFilter").value = categories.includes(oldCat) ? oldCat : "All";

    const variables = activeVariables().filter(v => cleanBool(v.spc_enabled));
    const oldVar = $("variableFilter").value || "all";
    $("variableFilter").innerHTML = [
      `<option value="all">All selected variables</option>`,
      ...variables.map(v => `<option value="${htmlEscape(v.variable_id)}">${htmlEscape(v.label)}</option>`)
    ].join("");
    $("variableFilter").value = variables.some(v => v.variable_id === oldVar) ? oldVar : "all";
  }

  function selectedDashboardVariables() {
    const category = $("categoryFilter").value || "All";
    const variableId = $("variableFilter").value || "all";

    let vars = activeVariables().filter(v => cleanBool(v.spc_enabled));
    if (category !== "All") vars = vars.filter(v => (v.category || "Uncategorized") === category);
    if (variableId !== "all") vars = vars.filter(v => v.variable_id === variableId);
    return vars;
  }

  function renderDashboard() {
    if (!window.Plotly || !window.DashboardCharts) return;

    const dailyRows = buildDailyRows();
    const variables = selectedDashboardVariables();
    const displayMode = $("displayMode").value || "normalized";
    const varsById = variableById();

    DashboardCharts.renderCalendar("calendarChart", computeScores(dailyRows));

    const selectedForSpc = $("variableFilter").value === "all"
      ? variables[0]
      : varsById[$("variableFilter").value];

    DashboardCharts.renderSpcChart("spcChart", selectedForSpc, dailyRows);
    DashboardCharts.renderTrendChart("trendChart", variables, dailyRows, displayMode);
    DashboardCharts.renderNutritionChart("nutritionChart", varsById, dailyRows);
    DashboardCharts.renderHistogram("histogramChart", variables, dailyRows, displayMode);
    renderCorrelationTable(variables, dailyRows);
    renderRecommendations(variables, dailyRows);
  }

  function renderCorrelationTable(variables, dailyRows) {
    const corr = DashboardCharts.computeCorrelations(variables, dailyRows);
    $("correlationTable").innerHTML = `
      <thead><tr><th>Variable A</th><th>Variable B</th><th>r</th><th>Direction</th></tr></thead>
      <tbody>
      ${corr.map(c => `
        <tr>
          <td>${htmlEscape(c.a)}</td>
          <td>${htmlEscape(c.b)}</td>
          <td>${c.r.toFixed(3)}</td>
          <td>${c.r >= 0 ? "Positive" : "Negative"}</td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="muted">Need at least 3 overlapping daily data points.</td></tr>`}
      </tbody>
    `;
  }

  function renderRecommendations(variables, dailyRows) {
    const recs = [];
    if (!dailyRows.length) {
      $("recommendations").innerHTML = `<p class="muted">Start logging entries and meals to generate recommendations.</p>`;
      return;
    }

    function rateOutside(v) {
      const values = dailyRows.map(r => toNum(r[v.variable_id])).filter(x => x !== null);
      if (values.length < 3) return null;
      const lcl = toNum(v.lcl);
      const ucl = toNum(v.ucl);
      const below = values.filter(x => lcl !== null && x < lcl).length;
      const above = values.filter(x => ucl !== null && x > ucl).length;
      return { n: values.length, below, above, belowRate: below / values.length, aboveRate: above / values.length };
    }

    for (const v of variables) {
      const r = rateOutside(v);
      if (!r) continue;
      if (r.belowRate >= 0.35) {
        recs.push(`${v.label} is below its lower goal band on ${Math.round(r.belowRate * 100)}% of logged days. Consider lowering the goal temporarily or designing a more reliable cue/action.`);
      }
      if (r.aboveRate >= 0.35) {
        recs.push(`${v.label} is above its upper goal band on ${Math.round(r.aboveRate * 100)}% of logged days. Check whether this is actually a problem or just an overly tight sigma band.`);
      }
    }

    const varsById = variableById();
    const protein = varsById.protein;
    const calories = varsById.calories;
    const sleep = varsById.sleep;
    if (protein) {
      const r = rateOutside(protein);
      if (r && r.belowRate >= 0.25) recs.unshift("Protein is frequently low. Add one default high-protein fallback meal or snack so this does not rely on willpower.");
    }
    if (calories) {
      const r = rateOutside(calories);
      if (r && r.aboveRate >= 0.25) recs.unshift("Calories are often above the goal band. Review meals tagged high_fat or high_carb first; they usually explain the largest calorie swings.");
    }
    if (sleep) {
      const r = rateOutside(sleep);
      if (r && r.belowRate >= 0.25) recs.unshift("Sleep is frequently below the band. Consider correlating caffeine, alcohol, social, and late meals against next-day sleep.");
    }

    if (!recs.length) {
      recs.push("No major recurring goal-band issues detected yet. Keep logging until you have at least 2–4 weeks of data.");
    }

    $("recommendations").innerHTML = recs.slice(0, 8).map(r => `<div class="recommendation">${htmlEscape(r)}</div>`).join("");
  }

  function renderVariableEditor() {
    const table = $("variablesTable");
    table.innerHTML = `
      <thead>
        <tr>
          <th>ID</th><th>Label</th><th>Category</th><th>Type</th><th>Unit</th>
          <th>Goal</th><th>Sigma</th><th>LCL</th><th>UCL</th>
          <th>Higher?</th><th>Active</th><th>Source</th><th>Score</th><th>SPC</th><th>Retired</th><th>Notes</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${state.variables.map((v, i) => variableEditorRow(v, i)).join("")}
      </tbody>
    `;
    document.querySelectorAll(".retire-variable").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        state.variables[idx].active = "FALSE";
        state.variables[idx].retired_at = todayStr();
        renderVariableEditor();
        toast("Variable marked inactive. Click Save Variables to persist.");
      });
    });
  }

  function variableEditorRow(v, index) {
    const types = ["numeric", "binary", "proportion", "count", "minutes", "grams", "kcal", "text"];
    const sources = ["manual", "meal_rollup", "computed"];
    const boolOptions = ["TRUE", "FALSE", ""];
    const activeOptions = ["TRUE", "FALSE"];

    function opts(values, current) {
      return values.map(x => `<option value="${htmlEscape(x)}" ${String(current).toUpperCase() === String(x).toUpperCase() ? "selected" : ""}>${htmlEscape(x || "within band")}</option>`).join("");
    }

    return `
      <tr data-var-index="${index}">
        <td><input data-field="variable_id" value="${htmlEscape(v.variable_id)}" /></td>
        <td><input data-field="label" value="${htmlEscape(v.label)}" /></td>
        <td><input data-field="category" value="${htmlEscape(v.category)}" /></td>
        <td><select data-field="type">${opts(types, v.type)}</select></td>
        <td><input data-field="unit" value="${htmlEscape(v.unit)}" /></td>
        <td><input data-field="goal_daily_avg" type="number" step="0.01" value="${htmlEscape(v.goal_daily_avg)}" /></td>
        <td><input data-field="goal_sigma" type="number" step="0.01" value="${htmlEscape(v.goal_sigma)}" /></td>
        <td><input data-field="lcl" type="number" step="0.01" value="${htmlEscape(v.lcl)}" /></td>
        <td><input data-field="ucl" type="number" step="0.01" value="${htmlEscape(v.ucl)}" /></td>
        <td><select data-field="higher_is_better">${opts(boolOptions, v.higher_is_better)}</select></td>
        <td><select data-field="active">${opts(activeOptions, v.active)}</select></td>
        <td><select data-field="entry_source">${opts(sources, v.entry_source)}</select></td>
        <td><select data-field="required_for_score">${opts(activeOptions, v.required_for_score)}</select></td>
        <td><select data-field="spc_enabled">${opts(activeOptions, v.spc_enabled)}</select></td>
        <td><input data-field="retired_at" type="date" value="${htmlEscape(v.retired_at)}" /></td>
        <td><input data-field="notes" value="${htmlEscape(v.notes)}" /></td>
        <td><button class="danger retire-variable" data-index="${index}">Retire</button></td>
      </tr>
    `;
  }

  function readVariableEditor() {
    const rows = [...document.querySelectorAll("#variablesTable tbody tr")];
    state.variables = rows.map((tr, i) => {
      const original = state.variables[i] || {};
      const obj = { ...original };
      for (const input of tr.querySelectorAll("[data-field]")) {
        obj[input.dataset.field] = input.value;
      }
      obj.variable_id = slugify(obj.variable_id);
      obj.label = obj.label || obj.variable_id;
      obj.source_label = original.source_label || obj.label;
      obj.created_at = original.created_at || todayStr();
      return normalizeVariable(obj);
    });
  }

  function addVariable() {
    readVariableEditor();
    const stamp = todayStr();
    state.variables.push(normalizeVariable({
      variable_id: `new_variable_${Date.now()}`,
      label: "New Variable",
      source_label: "New Variable",
      category: "Uncategorized",
      type: "numeric",
      unit: "",
      goal_daily_avg: 1,
      goal_sigma: 0.1,
      lcl: 0.8,
      ucl: 1.2,
      higher_is_better: "TRUE",
      active: "TRUE",
      entry_source: "manual",
      required_for_score: "FALSE",
      spc_enabled: "TRUE",
      created_at: stamp,
      retired_at: "",
      notes: "Added in app."
    }));
    renderVariableEditor();
  }

  function recomputeLimits() {
    readVariableEditor();
    for (const v of state.variables) {
      const goal = toNum(v.goal_daily_avg);
      const sigma = toNum(v.goal_sigma);
      if (goal === null || sigma === null) continue;
      let lcl = goal - 2 * sigma;
      let ucl = goal + 2 * sigma;
      if (["binary", "proportion"].includes(v.type)) {
        lcl = Math.max(0, lcl);
        ucl = Math.min(1, ucl);
      }
      if (goal === 0) lcl = 0;
      v.lcl = String(Math.round(lcl * 10000) / 10000);
      v.ucl = String(Math.round(ucl * 10000) / 10000);
    }
    renderVariableEditor();
    toast("Recomputed LCL/UCL as goal ± 2σ. Click Save Variables to persist.");
  }

  function saveVariables() {
    readVariableEditor();
    saveCache();
    renderAll();
    toast("Variables saved locally.");
    $("syncStatus").textContent = "Variable config saved locally. Click GitHub Sync → Save CSVs to GitHub when ready.";
  }

  function setupEvents() {
    $("pinButton").addEventListener("click", handlePin);
    $("pinInput").addEventListener("keydown", e => {
      if (e.key === "Enter") handlePin();
    });
    $("lockButton").addEventListener("click", lockApp);

    document.querySelectorAll(".tab-button").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.add("active");
        if (btn.dataset.tab === "dashboardTab") setTimeout(renderDashboard, 80);
      });
    });

    $("settingsToggle").addEventListener("click", () => $("syncPanel").classList.toggle("hidden"));
    $("saveGhSettings").addEventListener("click", () => {
      GitHubSync.saveSettings(currentGhSettings());
      toast("GitHub settings saved locally.");
    });
    $("loadGhData").addEventListener("click", loadFromGitHub);
    $("saveGhData").addEventListener("click", saveToGitHub);

    $("entryDate").addEventListener("change", renderDailyForm);
    $("mealDate").addEventListener("change", renderMealTab);
    $("saveDailyEntry").addEventListener("click", saveDailyEntry);
    $("saveMeal").addEventListener("click", saveMeal);

    $("categoryFilter").addEventListener("change", renderDashboard);
    $("variableFilter").addEventListener("change", renderDashboard);
    $("displayMode").addEventListener("change", renderDashboard);
    $("refreshDashboard").addEventListener("click", renderDashboard);

    $("addVariable").addEventListener("click", addVariable);
    $("recomputeLimits").addEventListener("click", recomputeLimits);
    $("saveVariables").addEventListener("click", saveVariables);

    window.addEventListener("resize", () => {
      if (window.Plotly) {
        ["calendarChart", "spcChart", "trendChart", "nutritionChart", "histogramChart"].forEach(id => {
          const el = $(id);
          if (el) Plotly.Plots.resize(el);
        });
      }
    });
  }

  window.addEventListener("DOMContentLoaded", async () => {
    setupEvents();
    if (sessionStorage.getItem("habitSpcUnlocked") === "true") {
      await unlockApp();
    } else {
      $("pinInput").focus();
    }
  });
})();
