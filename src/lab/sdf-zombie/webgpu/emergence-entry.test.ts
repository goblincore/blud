import { describe, expect, it } from 'vitest';
import { AUTOSTART_DEBUG_S, AUTOSTART_TRAIN_S, FADE_IN_TRAIN_S, emergenceEntry } from './emergence-entry';

describe('emergenceEntry', () => {
  it('the debug flag: autostart after the usual delay, no fade, no stored picture', () => {
    expect(emergenceEntry('?level=flat-early&emergence=1')).toEqual({ fromTrain: false, autostart: true, delayS: AUTOSTART_DEBUG_S, fadeInS: 0 });
  });
  it('from the Night Train: autostart soon, fade up from black, take the stored picture', () => {
    const e = emergenceEntry('?level=flat-early&emergence=1&from=night-train');
    expect(e).toEqual({ fromTrain: true, autostart: true, delayS: AUTOSTART_TRAIN_S, fadeInS: FADE_IN_TRAIN_S });
    expect(emergenceEntry('?level=flat-early&from=night-train').autostart).toBe(true);   // from= implies emergence=1
  });
  it('a bare flat-early load does not autostart; emergence=0 never does, even from the train', () => {
    expect(emergenceEntry('?level=flat-early').autostart).toBe(false);
    expect(emergenceEntry('?level=flat-early&emergence=0&from=night-train').autostart).toBe(false);
  });
  it('only from=night-train counts', () => {
    expect(emergenceEntry('?from=somewhere').fromTrain).toBe(false);
  });
});
