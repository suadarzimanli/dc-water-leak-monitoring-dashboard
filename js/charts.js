let chartInstance = null;

export function renderZoneChart(canvas, history, theme = {}) {
  const labels = history.map((row) =>
    row.timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" })
  );
  const flow = history.map((row) => row.flowLps);
  const pressure = history.map((row) => row.pressurePsi);

  const textColor = theme.text ?? "#9fb0cc";
  const gridColor = theme.grid ?? "rgba(255,255,255,0.06)";
  const flowColor = theme.flow ?? "#2ea8ff";
  const pressureColor = theme.pressure ?? "#1dd3b0";

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Flow (L/s)",
          data: flow,
          borderColor: flowColor,
          backgroundColor: `${flowColor}26`,
          tension: 0.25,
          yAxisID: "y",
        },
        {
          label: "Pressure (psi)",
          data: pressure,
          borderColor: pressureColor,
          backgroundColor: `${pressureColor}1f`,
          tension: 0.25,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: textColor },
        },
      },
      scales: {
        x: {
          ticks: { color: textColor, maxTicksLimit: 6 },
          grid: { color: gridColor },
        },
        y: {
          position: "left",
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
        y1: {
          position: "right",
          ticks: { color: textColor },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });

  return chartInstance;
}

export function destroyZoneChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}
