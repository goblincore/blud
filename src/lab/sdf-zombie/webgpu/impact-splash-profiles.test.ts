import { expect, it } from 'vitest';
import { resolveImpactSplashProfile } from './impact-splash-profiles';
import { createImpactSplashEvent } from './impact-splash';
it('bounds runtime inputs without propagating non-finite values', () => {
  expect(resolveImpactSplashProfile({scale:NaN,speed:Infinity,opacity:2,count:999})).toEqual({scale:1,speed:1,opacity:1,count:32,spread:1.1,duration:.9});
  expect(resolveImpactSplashProfile({scale:-1,speed:0,opacity:-1,count:0})).toEqual({scale:.1,speed:.1,opacity:0,count:0,spread:1.1,duration:.9});
});
it('snapshots per-impact tuning so later edits cannot change a live event', () => {
  const profile={scale:.5};
  const event=createImpactSplashEvent([0,0,0],[0,0,1],5,{profile});
  profile.scale=2;
  expect(event.profile?.scale).toBe(.5);
});
