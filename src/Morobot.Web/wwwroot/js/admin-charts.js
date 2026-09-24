/**
 * Admin dashboard charts.
 *
 * Charts are rendered from JSON embedded in <script type="application/json"> blocks so the
 * view needs no inline JS and the values stay out of the markup (avoids escaping issues).
 * ApexCharts is loaded by the admin layout; if it is missing we leave the empty containers
 * as-is rather than throwing.
 */
(function () {
  "use strict";

  function readData(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "{}");
    } catch (e) {
      console.warn("[admin-charts] bad payload", id, e);
      return null;
    }
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function isRtl() {
    return (document.documentElement.getAttribute("dir") || "").toLowerCase() === "rtl";
  }

  function render() {
    if (typeof ApexCharts === "undefined") return;

    var rtl = isRtl();
    var font = "Vazirmatn, Tahoma, sans-serif";
    var primary = cssVar("--morobot-primary", "#0f766e");

    var activity = readData("admin-chart-activity-data");
    var activityHost = document.getElementById("admin-chart-activity");
    if (activity && activityHost && Array.isArray(activity.labels) && activity.labels.length) {
      new ApexCharts(activityHost, {
        chart: {
          type: "area",
          height: 260,
          fontFamily: font,
          toolbar: { show: false },
          animations: { enabled: false }
        },
        series: [
          { name: activity.seriesEvents || "Events", data: activity.events || [] },
          { name: activity.seriesProcesses || "Processes", data: activity.processes || [] },
          { name: activity.seriesPlays || "Plays", data: activity.plays || [] }
        ],
        labels: activity.labels,
        xaxis: { categories: activity.labels, tickAmount: Math.min(7, activity.labels.length) },
        stroke: { curve: "smooth", width: 2 },
        fill: { type: "gradient", gradient: { opacityFrom: 0.35, opacityTo: 0.05 } },
        colors: [primary, "#6366f1", "#f59e0b"],
        legend: { position: "top", horizontalAlign: rtl ? "right" : "left" },
        grid: { borderColor: "rgba(148,163,184,.25)" },
        dataLabels: { enabled: false },
        tooltip: { shared: true, intersect: false }
      }).render();
    }

    var levels = readData("admin-chart-levels-data");
    var levelsHost = document.getElementById("admin-chart-levels");
    if (levels && levelsHost && Array.isArray(levels.labels) && levels.labels.length) {
      new ApexCharts(levelsHost, {
        chart: { type: "donut", height: 230, fontFamily: font, animations: { enabled: false } },
        series: levels.counts || [],
        labels: levels.labels,
        colors: ["#22c55e", "#f59e0b", "#ef4444", "#6366f1", "#94a3b8"],
        legend: { position: "bottom", horizontalAlign: "center" },
        dataLabels: { enabled: true },
        stroke: { width: 2, colors: ["#fff"] }
      }).render();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
