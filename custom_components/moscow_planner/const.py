"""Constants for the MoSCoW Planner integration."""

DOMAIN = "moscow_planner"
VERSION = "1.0.1"

STORAGE_KEY = f"{DOMAIN}.state"
STORAGE_VERSION = 1

URL_BASE = "/moscow_planner_static"
PANEL_URL_PATH = "moscow-planner"
MODULE_FILE = "moscow-planner.js"

SIGNAL_UPDATED = f"{DOMAIN}_updated"

EVENT_TASK_COMPLETED = f"{DOMAIN}_task_completed"
EVENT_PART_CHANGED = f"{DOMAIN}_part_changed"

BUCKETS = ["must", "should", "could", "wont"]
PARTS = ["morning", "afternoon", "evening", "night"]
