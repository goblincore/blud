/**
 * Crosshair-ring HUD showing weapon charge (0..1).
 *
 * Plain DOM + inline SVG. No canvas, no shader. The ring turns red in the
 * last 10% to signal impending over-cook / self-gib.
 */
export class ChargeHud {
  private readonly el: HTMLElement;
  private readonly circle: SVGCircleElement;
  private readonly crosshair: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      width: 64px; height: 64px;
    `;
    this.el.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64"
           style="position:absolute; inset:0;">
        <circle cx="32" cy="32" r="26" fill="none" stroke="#fff3"
                stroke-width="3"/>
        <circle cx="32" cy="32" r="26" fill="none" stroke="#ffcc00"
                stroke-width="3" stroke-linecap="round"
                stroke-dasharray="163"
                stroke-dashoffset="163"
                transform="rotate(-90 32 32)"
                id="charge-ring"/>
      </svg>
      <div style="position:absolute; inset:0; display:flex;
                  align-items:center; justify-content:center;
                  color:#fff; font-size:20px;">+</div>
    `;
    root.appendChild(this.el);
    this.circle = this.el.querySelector('#charge-ring')!;
    this.crosshair = this.el.querySelector('div')!;
  }

  /** Call per frame. Pass charge 0..1. */
  setCharge(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    const circumference = 2 * Math.PI * 26;
    this.circle.setAttribute('stroke-dasharray', String(circumference));
    this.circle.setAttribute('stroke-dashoffset', String(circumference * (1 - f)));
    this.circle.setAttribute('stroke', f > 0.9 ? '#ff3333' : '#ffcc00');
  }
}
