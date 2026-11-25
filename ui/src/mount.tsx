import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { TodayCard, type CardConfig } from "./TodayCard";
import type { StorageAdapter } from "./storage";
import css from "./styles.css";

function prepare(host: HTMLElement): HTMLElement {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const style = document.createElement("style");
  style.textContent = css;
  const container = document.createElement("div");
  shadow.append(style, container);
  return container;
}

export interface Mounted {
  unmount(): void;
}

export function mountPlanner(host: HTMLElement, adapter: StorageAdapter, onMenu?: () => void): Mounted {
  const root: Root = createRoot(prepare(host));
  root.render(<App adapter={adapter} onMenu={onMenu} />);
  return { unmount: () => root.unmount() };
}

export function mountCard(host: HTMLElement, adapter: StorageAdapter, config: CardConfig): Mounted {
  const root: Root = createRoot(prepare(host));
  root.render(<TodayCard adapter={adapter} config={config} />);
  return { unmount: () => root.unmount() };
}
