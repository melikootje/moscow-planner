import { mountCard, mountPlanner, type Mounted } from "./mount";
import { createDbAdapter, createHaAdapter, createLocalAdapter, type Hass } from "./storage";
import type { CardConfig } from "./TodayCard";

/** Used by the standalone page: pick the best storage available and mount. */
async function start(host: HTMLElement): Promise<Mounted> {
  const adapter = (await createDbAdapter()) ?? createLocalAdapter();
  return mountPlanner(host, adapter);
}

(window as unknown as { MoscowPlanner: unknown }).MoscowPlanner = { start, mountPlanner, createLocalAdapter, createDbAdapter };

/* ---------- Home Assistant custom elements ---------- */

class HaBase extends HTMLElement {
  protected _hass?: Hass;
  protected mounted?: Mounted;

  set hass(value: Hass) {
    this._hass = value;
    const dark = value.themes?.darkMode;
    if (dark === true) this.setAttribute("data-theme", "dark");
    else if (dark === false) this.setAttribute("data-theme", "light");
    if (!this.mounted) this.mountOnce();
  }
  get hass(): Hass | undefined {
    return this._hass;
  }
  protected mountOnce(): void {
    /* overridden */
  }
  disconnectedCallback(): void {
    this.mounted?.unmount();
    this.mounted = undefined;
  }
  connectedCallback(): void {
    if (this._hass && !this.mounted) this.mountOnce();
  }
}

class MoscowPlannerPanel extends HaBase {
  narrow = false;
  panel: unknown;
  protected mountOnce(): void {
    this.style.display = "block";
    this.style.minHeight = "100%";
    this.mounted = mountPlanner(this, createHaAdapter(() => this._hass));
  }
}

class MoscowPlannerCard extends HaBase {
  private config: CardConfig = {};
  setConfig(config: CardConfig): void {
    this.config = config ?? {};
    if (this.mounted) {
      this.mounted.unmount();
      this.mounted = undefined;
      if (this._hass) this.mountOnce();
    }
  }
  getCardSize(): number {
    return 4;
  }
  static getStubConfig(): CardConfig {
    return { part: "auto" };
  }
  protected mountOnce(): void {
    this.mounted = mountCard(this, createHaAdapter(() => this._hass), this.config);
  }
}

if (!customElements.get("moscow-planner-panel")) customElements.define("moscow-planner-panel", MoscowPlannerPanel);
if (!customElements.get("moscow-planner-card")) {
  customElements.define("moscow-planner-card", MoscowPlannerCard);
  const w = window as unknown as { customCards?: unknown[] };
  w.customCards = w.customCards ?? [];
  w.customCards.push({
    type: "moscow-planner-card",
    name: "MoSCoW Planner",
    description: "Today's tasks for the current day part, with check-offs.",
  });
}
