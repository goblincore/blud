/**
 * Horror-themed pause menu overlay for BLUD.
 *
 * Visual: Creepster font, blood-red/bone-white on near-black, CSS scanline
 * overlay, red glow on selected items, keyboard + mouse navigation.
 *
 * Triggers on Escape while pointer is locked. Exits pointer lock and freezes
 * the game loop (paused=true). Resuming re-locks the pointer.
 */

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Creepster&display=swap');";

const STYLES = /* css */ `
${FONT_IMPORT}

.blud-pause {
  position: fixed; inset: 0; z-index: 9000;
  display: none; flex-direction: column;
  align-items: center; justify-content: center;
  font-family: 'Creepster', 'Courier New', monospace;
  color: #d4c5a9;
  user-select: none;
}

/* dark overlay with scanlines */
.blud-pause__backdrop {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0, 0, 0, 0.15) 2px,
      rgba(0, 0, 0, 0.15) 4px
    ),
    rgba(5, 2, 2, 0.88);
}

.blud-pause__panel {
  position: relative; z-index: 1;
  min-width: 320px; max-width: 420px; width: 90vw;
  padding: 36px 40px 28px;
  border: 1px solid #5a1a1a;
  background: rgba(12, 4, 4, 0.92);
  box-shadow: 0 0 60px rgba(139, 0, 0, 0.25), inset 0 0 30px rgba(0,0,0,0.4);
}

.blud-pause__title {
  font-size: 52px;
  color: #cc2020;
  text-shadow:
    0 0 8px rgba(204, 32, 32, 0.6),
    0 0 20px rgba(139, 0, 0, 0.3);
  text-align: center;
  margin: 0 0 28px;
  letter-spacing: 6px;
}

.blud-pause__item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  font-family: 'Creepster', 'Courier New', monospace;
  font-size: 22px;
  color: #d4c5a9;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: border-color 0.15s, color 0.15s, text-shadow 0.15s;
  background: none; border-top: none; border-right: none; border-bottom: none;
  width: 100%; text-align: left;
  outline: none;
}

.blud-pause__item:hover,
.blud-pause__item.active {
  color: #ff4444;
  border-left-color: #cc2020;
  text-shadow: 0 0 6px rgba(204, 32, 32, 0.5);
}

/* toggle switch */
.blud-pause__toggle {
  position: relative;
  width: 36px; height: 18px;
  background: #2a1010;
  border-radius: 9px;
  margin-left: auto;
  flex-shrink: 0;
  transition: background 0.2s;
}

.blud-pause__toggle::after {
  content: '';
  position: absolute;
  top: 2px; left: 2px;
  width: 14px; height: 14px;
  background: #d4c5a9;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.blud-pause__toggle.on {
  background: #8b0000;
}

.blud-pause__toggle.on::after {
  transform: translateX(18px);
  background: #ff4444;
}

/* section label */
.blud-pause__section {
  font-size: 14px;
  color: #6a3a3a;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin: 20px 0 6px 14px;
  font-family: 'Courier New', monospace;
}

/* volume slider */
.blud-pause__slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: #2a1010;
  border-radius: 2px;
  outline: none;
  margin: 8px 0;
}

.blud-pause__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px; height: 14px;
  background: #cc2020;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(204, 32, 32, 0.5);
}

.blud-pause__slider::-moz-range-thumb {
  width: 14px; height: 14px;
  background: #cc2020;
  border: none;
  border-radius: 50%;
  cursor: pointer;
}

.blud-pause__vol-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 14px;
  font-size: 16px;
}

.blud-pause__vol-pct {
  font-family: 'Courier New', monospace;
  font-size: 14px;
  color: #8a5a5a;
  min-width: 32px;
  text-align: right;
}

/* confirm dialog */
.blud-pause__confirm {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
  padding: 16px;
  border: 1px solid #5a1a1a;
  background: rgba(20, 4, 4, 0.95);
}

.blud-pause__confirm-text {
  font-size: 20px;
  color: #cc2020;
  text-shadow: 0 0 8px rgba(204, 32, 32, 0.4);
}

.blud-pause__confirm-btns {
  display: flex; gap: 20px;
}

.blud-pause__confirm-btn {
  font-family: 'Creepster', 'Courier New', monospace;
  font-size: 18px;
  padding: 6px 24px;
  background: none;
  border: 1px solid #5a1a1a;
  color: #d4c5a9;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.blud-pause__confirm-btn:hover {
  color: #ff4444;
  border-color: #cc2020;
}
`;

// ── PostFxConfig shape ──────────────────────────────────────────────
interface PostFxToggle {
  enabled: boolean;
  [k: string]: unknown;
}

interface PostFxConfig {
  vignette: PostFxToggle;
  dither: PostFxToggle;
  ca: PostFxToggle;
  grain: PostFxToggle;
  scanlines: PostFxToggle;
  barrel: PostFxToggle;
}

// ── Menu item types ─────────────────────────────────────────────────
type MenuItem =
  | { kind: "action"; label: string; action: () => void }
  | { kind: "toggle"; label: string; key: keyof PostFxConfig }
  | { kind: "slider"; label: string };

// ── PauseMenu ───────────────────────────────────────────────────────

export class PauseMenu {
  private readonly el: HTMLDivElement;
  private readonly items: MenuItem[] = [];
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly toggleEls: Map<keyof PostFxConfig, HTMLElement> = new Map();
  private confirmEl: HTMLDivElement | null = null;
  private volLabel: HTMLElement | null = null;

  private _paused = false;
  private activeIdx = 0;
  private styleInjected = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly cfg: PostFxConfig,
    private readonly sfxGain: GainNode,
  ) {
    this.el = this.build();
    this.root.appendChild(this.el);
    this.listen();
  }

  get paused(): boolean {
    return this._paused;
  }

  show(): void {
    this._paused = true;
    this.activeIdx = 0;
    this.hideConfirm();
    this.syncToggles();
    this.highlightActive();
    this.el.style.display = "flex";
    document.exitPointerLock();
  }

  hide(): void {
    this._paused = false;
    this.el.style.display = "none";
    this.canvas.requestPointerLock();
  }

  // ── DOM construction ────────────────────────────────────────────

  private build(): HTMLDivElement {
    this.injectStyles();

    const el = document.createElement("div");
    el.className = "blud-pause";

    // backdrop with scanlines
    const backdrop = document.createElement("div");
    backdrop.className = "blud-pause__backdrop";
    el.appendChild(backdrop);

    // panel
    const panel = document.createElement("div");
    panel.className = "blud-pause__panel";

    // title
    const title = document.createElement("div");
    title.className = "blud-pause__title";
    title.textContent = "PAUSED";
    panel.appendChild(title);

    // ── Actions ──
    const resumeItem: MenuItem = { kind: "action", label: "Resume", action: () => this.hide() };
    const quitItem: MenuItem = { kind: "action", label: "Quit", action: () => this.showConfirm() };

    this.items.push(resumeItem);

    // ── Post-FX section ──
    panel.appendChild(this.makeSection("POST-FX"));

    const fxKeys: (keyof PostFxConfig)[] = ["vignette", "dither", "ca", "grain", "scanlines", "barrel"];
    for (const key of fxKeys) {
      const item: MenuItem = { kind: "toggle", label: key.toUpperCase(), key };
      this.items.push(item);
      panel.appendChild(this.makeToggleRow(item, key));
    }

    // ── Volume section ──
    panel.appendChild(this.makeSection("AUDIO"));

    const volItem: MenuItem = { kind: "slider", label: "Volume" };
    this.items.push(volItem);
    panel.appendChild(this.makeVolumeRow());

    // ── Quit ──
    this.items.push(quitItem);

    // build action buttons (resume + quit)
    const resumeBtn = this.makeButton(resumeItem);
    panel.insertBefore(resumeBtn, panel.children[1]!); // right after title

    this.actionButtons.push(resumeBtn);

    const quitBtn = this.makeButton(quitItem);
    panel.appendChild(quitBtn);
    this.actionButtons.push(quitBtn);

    // confirm overlay
    this.confirmEl = this.makeConfirm();
    panel.appendChild(this.confirmEl);

    el.appendChild(panel);
    return el;
  }

  private makeSection(label: string): HTMLElement {
    const sec = document.createElement("div");
    sec.className = "blud-pause__section";
    sec.textContent = label;
    return sec;
  }

  private makeButton(item: MenuItem): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "blud-pause__item";
    btn.textContent = item.kind === "action" ? item.label : "";
    btn.addEventListener("click", () => {
      if (item.kind === "action") item.action();
    });
    return btn;
  }

  private makeToggleRow(item: MenuItem, key: keyof PostFxConfig): HTMLElement {
    const row = document.createElement("button");
    row.className = "blud-pause__item";
    row.innerHTML = `<span>${item.kind === "toggle" ? item.label : key}</span>`;

    const toggle = document.createElement("div");
    toggle.className = "blud-pause__toggle";
    toggle.dataset.fxKey = key;
    row.appendChild(toggle);

    this.toggleEls.set(key, toggle);

    row.addEventListener("click", () => {
      this.flipToggle(key);
    });

    return row;
  }

  private makeVolumeRow(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "blud-pause__vol-row";

    const label = document.createElement("span");
    label.textContent = "VOLUME";
    label.style.fontSize = "22px";
    label.style.flex = "1";
    wrap.appendChild(label);

    this.volLabel = document.createElement("span");
    this.volLabel.className = "blud-pause__vol-pct";
    wrap.appendChild(this.volLabel);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.className = "blud-pause__slider";
    slider.style.width = "100%";

    const currentVol = Math.round(this.sfxGain.gain.value * 100);
    slider.value = String(currentVol);
    this.updateVolLabel(currentVol);

    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      this.sfxGain.gain.value = v * 0.01;
      this.updateVolLabel(v);
    });

    // slider goes in its own row below the label row
    const sliderWrap = document.createElement("div");
    sliderWrap.style.padding = "0 14px";
    sliderWrap.appendChild(slider);

    const container = document.createElement("div");
    container.appendChild(wrap);
    container.appendChild(sliderWrap);
    return container;
  }

  private makeConfirm(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "blud-pause__confirm";

    const text = document.createElement("div");
    text.className = "blud-pause__confirm-text";
    text.textContent = "ARE YOU SURE?";

    const btns = document.createElement("div");
    btns.className = "blud-pause__confirm-btns";

    const yes = document.createElement("button");
    yes.className = "blud-pause__confirm-btn";
    yes.textContent = "YES";
    yes.addEventListener("click", () => {
      window.location.reload();
    });

    const no = document.createElement("button");
    no.className = "blud-pause__confirm-btn";
    no.textContent = "NO";
    no.addEventListener("click", () => this.hideConfirm());

    btns.appendChild(yes);
    btns.appendChild(no);
    el.appendChild(text);
    el.appendChild(btns);
    return el;
  }

  // ── State helpers ────────────────────────────────────────────────

  private flipToggle(key: keyof PostFxConfig): void {
    this.cfg[key].enabled = !this.cfg[key].enabled;
    this.syncToggle(key);
  }

  private syncToggle(key: keyof PostFxConfig): void {
    const el = this.toggleEls.get(key);
    if (!el) return;
    el.classList.toggle("on", this.cfg[key].enabled);
  }

  private syncToggles(): void {
    for (const key of this.toggleEls.keys()) {
      this.syncToggle(key);
    }
  }

  private updateVolLabel(v: number): void {
    if (this.volLabel) this.volLabel.textContent = `${v}%`;
  }

  private showConfirm(): void {
    if (this.confirmEl) this.confirmEl.style.display = "flex";
  }

  private hideConfirm(): void {
    if (this.confirmEl) this.confirmEl.style.display = "none";
  }

  // ── Keyboard navigation ─────────────────────────────────────────

  private highlightActive(): void {
    const all = this.el.querySelectorAll<HTMLButtonElement>(".blud-pause__item");
    all.forEach((btn, i) => btn.classList.toggle("active", i === this.activeIdx));
  }

  private get navigableItems(): HTMLButtonElement[] {
    return Array.from(this.el.querySelectorAll<HTMLButtonElement>(".blud-pause__item"));
  }

  // ── Event listeners ─────────────────────────────────────────────

  private listen(): void {
    window.addEventListener("keydown", (e) => {
      // Escape toggles pause
      if (e.code === "Escape") {
        e.preventDefault();
        if (this._paused) this.hide();
        else this.show();
        return;
      }

      if (!this._paused) return;

      const nav = this.navigableItems;

      if (e.code === "ArrowUp") {
        e.preventDefault();
        this.activeIdx = (this.activeIdx - 1 + nav.length) % nav.length;
        this.highlightActive();
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        this.activeIdx = (this.activeIdx + 1) % nav.length;
        this.highlightActive();
      } else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        nav[this.activeIdx]?.click();
      }
    });
  }

  // ── Style injection ─────────────────────────────────────────────

  private injectStyles(): void {
    if (this.styleInjected) return;
    this.styleInjected = true;
    const tag = document.createElement("style");
    tag.textContent = STYLES;
    document.head.appendChild(tag);
  }
}
