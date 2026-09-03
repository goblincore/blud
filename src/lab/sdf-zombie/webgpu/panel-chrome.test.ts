// src/lab/sdf-zombie/webgpu/panel-chrome.test.ts
import { describe, expect, it } from 'vitest';
import { createPanelShell } from './panel-chrome';

describe('createPanelShell', () => {
  it('SHIPS COLLAPSED — the body is what covers the frame', () => {
    const p = createPanelShell('TEST TUNING');
    expect(p.collapsed).toBe(true);
    expect(p.body.style.display).toBe('none');
    p.dispose();
  });
  it('still shows its title bar when collapsed, so it stays findable', () => {
    const p = createPanelShell('TEST TUNING');
    p.setVisible(true);
    expect(p.el.style.display).toBe('block');
    expect(p.el.textContent).toContain('TEST TUNING');
    p.dispose();
  });
  it('expands and re-collapses', () => {
    const p = createPanelShell('TEST TUNING');
    p.setCollapsed(false);
    expect(p.body.style.display).toBe('block');
    p.setCollapsed(true);
    expect(p.body.style.display).toBe('none');
    p.dispose();
  });
  it('keeps visibility and collapse independent', () => {
    const p = createPanelShell('TEST TUNING');
    p.setCollapsed(false);
    p.setVisible(false);
    expect(p.el.style.display).toBe('none');
    expect(p.collapsed).toBe(false);   // still expanded, just not shown
    p.dispose();
  });
  it('toggles collapse when the caret is clicked', () => {
    const p = createPanelShell('TEST TUNING');
    const caret = p.el.querySelector('button');
    (caret as HTMLButtonElement).click();
    expect(p.collapsed).toBe(false);
    p.dispose();
  });
});
