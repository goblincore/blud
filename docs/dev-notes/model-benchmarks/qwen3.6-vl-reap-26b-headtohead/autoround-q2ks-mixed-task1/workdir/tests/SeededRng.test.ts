import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/SeededRng';

describe('SeededRng', () => {
	it('same seed yields same sequence', () => {
		const rng1 = new SeededRng(42);
		const rng2 = new SeededRng(42);
		const seq1 = [];
		const seq2 = [];
		for (let i = 0; i < 10; i++) {
			seq1.push(rng1.next());
			seq2.push(rng2.next());
		}
		expect(seq1).toEqual(seq2);
	});

	it('different seeds yield different values', () => {
		const rng1 = new SeededRng(42);
		const rng2 = new SeededRng(99);
		expect(rng1.next()).not.toEqual(rng2.next());
	});

	it('nextInt returns values within [min,max] inclusive', () => {
		const rng = new SeededRng(123);
		const min = 3, max = 10;
		for (let i = 0; i < 100; i++) {
			const v = rng.nextInt(min, max);
			expect(v).toBeGreaterThanOrEqual(min);
			expect(v).toBeLessThanOrEqual(max);
		}
	});

	it('nextInt with min===max returns that value', () => {
		const rng = new SeededRng(1);
		expect(rng.nextInt(5, 5)).toBe(5);
	});

	it('nextFloat returns values in [min,max)', () => {
		const rng = new SeededRng(123);
		const min = 0.0, max = 1.0;
		for (let i = 0; i < 100; i++) {
			const v = rng.nextFloat(min, max);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('nextBool p=0 returns false always', () => {
		const rng = new SeededRng(99);
		for (let i = 0; i < 50; i++) {
			expect(rng.nextBool(0)).toBe(false);
		}
	});

	it('nextBool p=1 returns true always', () => {
		const rng = new SeededRng(99);
		for (let i = 0; i < 50; i++) {
			expect(rng.nextBool(1)).toBe(true);
		}
	});

	it('nextBool p=0.5 gives ~50% true', () => {
		const rng = new SeededRng(100);
		let count = 0;
		for (let i = 0; i < 100; i++) {
			if (rng.nextBool(0.5)) count++;
		}
		expect(count).toBeGreaterThan(10);
		expect(count).toBeLessThan(95);
	});

	it('pick returns elements from array', () => {
		const rng = new SeededRng(42);
		const arr = ['a', 'b', 'c', 'd', 'e'];
		for (let i = 0; i < 10; i++) {
			const el = rng.pick(arr);
			expect(arr).toContain(el);
		}
	});

	it('shuffle returns new array (not mutated)', () => {
		const rng = new SeededRng(1);
		const arr = [1, 2, 3, 4, 5];
		const shuffled = rng.shuffle(arr);
		expect(shuffled).not.toBe(arr);
		expect(arr).toEqual([1, 2, 3, 4, 5]);
		expect(new Set(shuffled)).toEqual(new Set(arr));
	});

	it('fork returns an independent instance', () => {
		// Create parent and fork, then both should produce different sequences
		const rng = new SeededRng(777);
		rng.next(); // consume one value
		const forked = rng.fork();
		
		// Both should produce different values
		const val1 = forked.next();
		const val2 = rng.next();
		
	 expect(val1).not.toEqual(val2);
	});
});