/* Chart rendering and statistics utilities for the SPC dashboard. */
(function () {
  function num(x) {
    const v = Number(x);
    return Number.isFinite(v) ? v : null;
  }

  function boolish(x) {
    return String(x).toLowerCase() === "true";
  }

  function layoutBase(title) {
    return {
      title: { text: title, x: 0, xanchor: "left" },
      margin: { l: 48, r: 22, t: 52, b: 52 },
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      hovermode: "closest",
      legend: { orientation: "h", y: -0.24 }
    };
  }

  function plotEmpty(id, message) {
    const el = document.getElementById(id);
    if (!el || !window.Plotly) return;
    Plotly.newPlot(id, [], {
      ...layoutBase(message),
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [{
        text: message,
        showarrow: false,
        x: 0.5,
        y: 0.5,
        xref: "paper",
        yref: "paper",
        font: { size: 16 }
      }]
    }, { responsive: true, displaylogo: false });
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
  }

  function dateRange(minDate, maxDate) {
    const out = [];
    if (!minDate || !maxDate) return out;
    const start = new Date(`${minDate}T00:00:00`);
    const end = new Date(`${maxDate}T00:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  function pearson(xs, ys) {
    const pairs = [];
    for (let i = 0; i < xs.length; i++) {
      const x = num(xs[i]);
      const y = num(ys[i]);
      if (x !== null && y !== null) pairs.push([x, y]);
    }
    if (pairs.length < 3) return null;

    const mx = pairs.reduce((a, p) => a + p[0], 0) / pairs.length;
    const my = pairs.reduce((a, p) => a + p[1], 0) / pairs.length;
    let nume = 0, dx = 0, dy = 0;

    for (const [x, y] of pairs) {
      nume += (x - mx) * (y - my);
      dx += (x - mx) ** 2;
      dy += (y - my) ** 2;
    }
    if (dx === 0 || dy === 0) return null;
    return nume / Math.sqrt(dx * dy);
  }

  function gaussianDensity(points, bins = 80) {
    const values = points.map(num).filter(v => v !== null);
    if (values.length < 2) return { x: [], y: [] };

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return { x: [min], y: [1] };

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(values.length - 1, 1)) || 1;
    const bandwidth = 1.06 * sd * values.length ** (-1 / 5) || 1;

    const xs = [];
    const ys = [];
    const step = (max - min) / (bins - 1);

    for (let i = 0; i < bins; i++) {
      const x = min + step * i;
      let density = 0;
      for (const v of values) {
        const z = (x - v) / bandwidth;
        density += Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      }
      density /= values.length * bandwidth;
      xs.push(x);
      ys.push(density);
    }
    return { x: xs, y: ys };
  }

  function renderCalendar(id, scoreByDate) {
    const dates = Object.keys(scoreByDate).sort();
    if (!dates.length) return plotEmpty(id, "No daily scores yet");

    const minDate = dates[0];
    const maxDate = new Date().toISOString().slice(0, 10);
    const allDates = dateRange(minDate, maxDate);
    const start = new Date(`${allDates[0]}T00:00:00`);
    const startDay = (start.getDay() + 6) % 7; // Monday = 0

    const weekVals = [];
    const dayVals = [];
    const zVals = [];
    const text = [];

    allDates.forEach((d, idx) => {
      const dayIndex = (new Date(`${d}T00:00:00`).getDay() + 6) % 7;
      const weekIndex = Math.floor((idx + startDay) / 7);
      weekVals.push(weekIndex);
      dayVals.push(dayIndex);
      const score = num(scoreByDate[d]);
      zVals.push(score === null ? null : Math.round(score * 100));
      text.push(`${d}<br>${score === null ? "No score" : Math.round(score * 100) + "% complete"}`);
    });

    const trace = {
      type: "scatter",
      mode: "markers",
      x: weekVals,
      y: dayVals,
      marker: {
        symbol: "square",
        size: 18,
        color: zVals,
        cmin: 0,
        cmax: 100,
        colorscale: [
          [0, "#e5e7eb"],
          [0.25, "#bfdbfe"],
          [0.5, "#60a5fa"],
          [0.75, "#2563eb"],
          [1, "#1e3a8a"]
        ],
        colorbar: { title: "Score" }
      },
      text,
      hovertemplate: "%{text}<extra></extra>"
    };

    Plotly.newPlot(id, [trace], {
      ...layoutBase("Daily aggregate completion"),
      xaxis: { title: "Week", showgrid: false, zeroline: false },
      yaxis: {
        tickmode: "array",
        tickvals: [0, 1, 2, 3, 4, 5, 6],
        ticktext: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        autorange: "reversed",
        showgrid: false,
        zeroline: false
      }
    }, { responsive: true, displaylogo: false });
  }

  function renderSpcChart(id, variable, dailyRows) {
    if (!variable) return plotEmpty(id, "Select a variable");
    const points = dailyRows
      .map(r => ({ date: r.date, value: num(r[variable.variable_id]) }))
      .filter(p => p.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!points.length) return plotEmpty(id, `No data for ${variable.label}`);

    const x = points.map(p => p.date);
    const y = points.map(p => p.value);
    const center = num(variable.goal_daily_avg);
    const lcl = num(variable.lcl);
    const ucl = num(variable.ucl);

    const traces = [
      {
        type: "scatter",
        mode: "lines+markers",
        x, y,
        name: variable.label,
        hovertemplate: "%{x}<br>%{y}<extra></extra>"
      }
    ];

    function lineTrace(value, name, dash) {
      if (value === null) return null;
      return {
        type: "scatter",
        mode: "lines",
        x,
        y: x.map(() => value),
        name,
        line: { dash },
        hoverinfo: "skip"
      };
    }

    [lineTrace(center, "Goal / Center", "solid"), lineTrace(lcl, "LCL", "dash"), lineTrace(ucl, "UCL", "dash")]
      .filter(Boolean)
      .forEach(t => traces.push(t));

    const flags = points.filter(p => (lcl !== null && p.value < lcl) || (ucl !== null && p.value > ucl));
    if (flags.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        x: flags.map(p => p.date),
        y: flags.map(p => p.value),
        name: "Outside ±2σ band",
        marker: { size: 12, symbol: "x" },
        hovertemplate: "%{x}<br>%{y}<extra>Flag</extra>"
      });
    }

    Plotly.newPlot(id, traces, {
      ...layoutBase(`${variable.label} SPC / goal band`),
      xaxis: { title: "Date" },
      yaxis: { title: variable.unit || "Value" }
    }, { responsive: true, displaylogo: false });
  }

  function renderTrendChart(id, variables, dailyRows, displayMode) {
    const selected = variables.filter(v => boolish(v.active) && boolish(v.spc_enabled));
    if (!selected.length || !dailyRows.length) return plotEmpty(id, "No trend data yet");

    const traces = [];
    for (const v of selected.slice(0, 18)) {
      const pts = dailyRows
        .map(r => ({ date: r.date, value: num(r[v.variable_id]) }))
        .filter(p => p.value !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (pts.length < 1) continue;

      let ys = pts.map(p => p.value);
      let titleSuffix = "";
      const goal = num(v.goal_daily_avg);
      if (displayMode === "normalized" && goal && goal !== 0) {
        ys = ys.map(y => y / goal);
        titleSuffix = " / goal";
      }

      traces.push({
        type: "scatter",
        mode: "lines+markers",
        x: pts.map(p => p.date),
        y: ys,
        name: v.label,
        hovertemplate: `%{x}<br>${v.label}: %{y:.3f}${titleSuffix}<extra></extra>`
      });
    }

    if (!traces.length) return plotEmpty(id, "No trend data yet");

    Plotly.newPlot(id, traces, {
      ...layoutBase(displayMode === "normalized" ? "Variables normalized to goal" : "Raw variables"),
      xaxis: { title: "Date" },
      yaxis: { title: displayMode === "normalized" ? "Actual / Goal" : "Raw value" }
    }, { responsive: true, displaylogo: false });
  }

  function renderNutritionChart(id, variablesById, dailyRows) {
    const ids = ["calories", "protein", "carbs", "fat"];
    const traces = [];
    for (const idv of ids) {
      const v = variablesById[idv];
      if (!v) continue;
      const pts = dailyRows
        .map(r => ({ date: r.date, value: num(r[idv]) }))
        .filter(p => p.value !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (!pts.length) continue;

      traces.push({
        type: "scatter",
        mode: "lines+markers",
        x: pts.map(p => p.date),
        y: pts.map(p => p.value),
        name: v.label,
        yaxis: idv === "calories" ? "y" : "y2"
      });
    }

    if (!traces.length) return plotEmpty(id, "No meal data yet");

    Plotly.newPlot(id, traces, {
      ...layoutBase("Meal rollup nutrition"),
      xaxis: { title: "Date" },
      yaxis: { title: "Calories" },
      yaxis2: {
        title: "Macros (g)",
        overlaying: "y",
        side: "right"
      }
    }, { responsive: true, displaylogo: false });
  }

  function renderHistogram(id, variables, dailyRows, displayMode) {
    const traces = [];
    for (const v of variables.slice(0, 8)) {
      let values = dailyRows.map(r => num(r[v.variable_id])).filter(x => x !== null);
      const goal = num(v.goal_daily_avg);
      if (displayMode === "normalized" && goal && goal !== 0) {
        values = values.map(x => x / goal);
      }
      if (values.length < 2) continue;
      traces.push({
        type: "histogram",
        x: values,
        histnorm: "probability density",
        opacity: 0.28,
        name: `${v.label} hist`
      });
      const kde = gaussianDensity(values);
      if (kde.x.length) {
        traces.push({
          type: "scatter",
          mode: "lines",
          x: kde.x,
          y: kde.y,
          name: `${v.label} curve`
        });
      }
    }

    if (!traces.length) return plotEmpty(id, "Need at least two data points per selected variable");

    Plotly.newPlot(id, traces, {
      ...layoutBase("Distributions"),
      barmode: "overlay",
      xaxis: { title: displayMode === "normalized" ? "Actual / Goal" : "Raw value" },
      yaxis: { title: "Density" }
    }, { responsive: true, displaylogo: false });
  }

  function computeCorrelations(variables, dailyRows) {
    const out = [];
    for (let i = 0; i < variables.length; i++) {
      for (let j = i + 1; j < variables.length; j++) {
        const a = variables[i];
        const b = variables[j];
        const xs = dailyRows.map(r => r[a.variable_id]);
        const ys = dailyRows.map(r => r[b.variable_id]);
        const r = pearson(xs, ys);
        if (r !== null) {
          out.push({
            a: a.label,
            b: b.label,
            r,
            strength: Math.abs(r)
          });
        }
      }
    }
    return out.sort((x, y) => y.strength - x.strength).slice(0, 20);
  }

  window.DashboardCharts = {
    renderCalendar,
    renderSpcChart,
    renderTrendChart,
    renderNutritionChart,
    renderHistogram,
    computeCorrelations,
    pearson,
    num,
    boolish,
    uniqueSorted,
    plotEmpty
  };
})();
