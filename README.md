# Urban Leak Monitoring Dashboard

Interactive **web-based demonstration** of distribution network monitoring for a **fictional North American city**. It uses **synthetic SCADA data** (flow and pressure), **in-browser machine learning** (logistic regression), **rule-based detection**, operational context, and a step-by-step **operator workflow**.

The application supports learning and exploration of how utilities detect possible leaks, review context, and manage incidents on a map.

**Unofficial educational project** — not affiliated with, endorsed by, or connected to any real water utility. All sensor values are simulated. Map coordinates are used for geographic context only; zone names and readings are fictional.

---

## Live application

**https://suadarzimanli.github.io/water-leak-monitoring-dashboard/**

---

## Run locally

```bash
git clone https://github.com/suadarzimanli/water-leak-monitoring-dashboard.git
cd water-leak-monitoring-dashboard
python -m http.server 8080
```

Open **http://localhost:8080** (do not open `index.html` as `file://`).

On Windows you can double-click `start-server.bat` instead.

**Recommended first step:** **Start guide** (10 steps), or **Generate Data** → **Train Model** → **Live Simulation**.

---

## Data and methods (summary)

- **8 pressure zones** with map coordinates (Leaflet + OpenStreetMap)
- **14 days** of synthetic hourly readings per zone (seeded generator)
- **Training labels** from simulator scenarios (`leak` vs normal / hydrant test / valve work, etc.)
- **Features:** normalized flow and pressure deltas, interaction term, hour-of-day
- **Model:** logistic regression trained in JavaScript (75/25 hold-out accuracy shown in UI)
- **Comparison:** rules-only detection mode on the same live stream
- **Operations:** incidents split into *active on map* vs *awaiting operator close-out*

---

## Application features

- Color-coded zone markers (normal / warning / likely leak)
- Metrics: zones at risk, pending review, close-out queue, work orders, model accuracy
- Zone inspector with flow/pressure chart and “why flagged” explanation
- Context tab: time of day, weather, maintenance, scenario assessment
- Action tab: acknowledge → work order → dispatch → confirm leak or false alarm
- Live simulation with adjustable speed; scripted scenarios (leak, hydrant test, valve work)
- Interactive 10-step user guide; light/dark theme

---

## Project structure

```
index.html
start-server.bat
css/
  styles.css
js/
  app.js
  config.js
  zones.js
  data.js
  context.js
  ml.js
  workflow.js
  map.js
  charts.js
  theme.js
  user-guide.js
LICENSE
CITATION.cff
README.md
```

External libraries (CDN): Leaflet, Chart.js. No `npm install` is required to run the app.

---

## License and citation

This repository is intended for **academic and educational use**.

It is licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)** — see [LICENSE](LICENSE).

If you use or reference this work, **please cite the author** (see [CITATION.cff](CITATION.cff) for machine-readable metadata).

> © 2026 — Research project by *Suad Arzimanli*
