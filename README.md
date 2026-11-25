# MoSCoW Planner

A day planner for Home Assistant. Sort the day into **Must / Should / Could / Won't** and into **day parts** (morning, afternoon, evening, night), each with its own time budget.

It runs as a standalone integration: a sidebar panel, a dashboard card, sensors, services and events. The same interface also runs outside Home Assistant as a web page (`web/index.html`).

## Install with HACS

1. HACS → Integrations → ⋮ → **Custom repositories** → add this repository, category **Integration**.
2. Install **MoSCoW Planner** and restart Home Assistant.
3. Settings → Devices & services → **Add integration** → *MoSCoW Planner*.

Manual install: copy `custom_components/moscow_planner` into your config's `custom_components` folder and restart.

## What you get

**Sidebar panel "MoSCoW".** Four columns, drag tasks between them (or use the M/S/C/W buttons on touch screens), filter by day part, drop a task on a part to move it there. Each part has a start time and an hours budget (gear icon). The "Must share" meter warns when Musts take more than the chosen share of planned time (default 60%). "Carry over" copies yesterday's unfinished Musts.

**Dashboard card.** Shows the current day part's tasks with check-offs. It is available on every dashboard after setup.

```yaml
type: custom:moscow-planner-card
part: auto            # or morning / afternoon / evening / night
title: Right now      # optional
hide_low_priority: false
```

**Entities** (one device)

| Entity | Meaning |
| --- | --- |
| `sensor.moscow_planner_current_day_part` | morning, afternoon, evening or night, from your start times |
| `sensor.moscow_planner_progress_today` | % of planned work finished; attributes hold counts and per-part numbers |
| `sensor.moscow_planner_musts_remaining` | unfinished Musts today |
| `sensor.moscow_planner_next_must` | title of the next unfinished Must (current part first) |
| `binary_sensor.moscow_planner_day_part_over_budget` | any part holds more planned time than its budget |
| `binary_sensor.moscow_planner_too_many_musts` | Musts exceed the share guide |
| `sensor.moscow_planner_<part>_planned` | planned minutes per part (disabled by default) |

**Services** (`moscow_planner.*`): `add_task`, `set_task_done`, `move_task`, `remove_task`, `clear_day`, `carry_over`, `get_day`. Tasks are addressed by `task_id` or exact `title`. `add_task` and `carry_over` return a response; `get_day` returns tasks and statistics.

**Events:** `moscow_planner_task_completed` (date, task_id, title, bucket, part) and `moscow_planner_part_changed` (part).

## Automation examples

```yaml
# Nudge when the evening starts and a Must is still open
triggers:
  - trigger: event
    event_type: moscow_planner_part_changed
    event_data: { part: evening }
conditions:
  - condition: numeric_state
    entity_id: sensor.moscow_planner_musts_remaining
    above: 0
actions:
  - action: notify.mobile_app_phone
    data:
      message: "Still open: {{ states('sensor.moscow_planner_next_must') }}"
```

```yaml
# Add a task from a voice command or button
actions:
  - action: moscow_planner.add_task
    data: { title: "Water the plants", bucket: should, part: evening, minutes: 10 }
```

## Data

Stored in `.storage/moscow_planner.state`. Dates use the Home Assistant time zone. Everything is local; nothing is sent anywhere.

## Development

```
cd ui && npm install && npm run typecheck && npm run build   # rebuilds frontend/moscow-planner.js and dist/
python3 web/build.py                                          # rebuilds web/index.html
pip install pytest-homeassistant-custom-component home-assistant-frontend && pytest
```

The UI is React + TypeScript. Storage is pluggable (`ui/src/storage.ts`): Home Assistant websocket, a Claude artifact database, or browser storage.
