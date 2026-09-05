export class SeededRng {
	private a: number;
	private b: number;
	private c: number;

	constructor(seed: number) {
		this.a = seed | 0;
		this.b = 0;
		this.c = 0;
	}

	/*
	 * Mulberry32 - a high-quality, fast, short-periodic PRNG
	 * Based on the reference implementation.
	 * The seed is used as the initial state `a`. `b` and `c` start at 0.
	 */
	private next32(): number {
		let t = this.a | 0;
		t = (16661 * (t | 0)) | 0;
		this.a = t;
		const s = (t ^ (t >> 11)) | 0;
		this.b = s;
		const u = (s ^ ((this.b << 10)) | 0) | 0;
		this.c = u;
		const v = (u ^ ((this.c >> 6)) | 0) | 0;
		this.a = v;
		return v;
	}

	/** Return a float in [0,1) */
	public next(): number {
		return this.next32() / 0x100000000;
	}

	/** Return an integer in [min,max] (inclusive) */
	public nextInt(min: number, max: number): number {
		if (min === max) return min;
		return (Math.floor(this.next() * (max - min + 1)) + min) | 0;
	}

	/** Return a float in [min,max) */
	public nextFloat(min: number, max: number): number {
		return min + this.next() * (max - min);
	}

	/** Return a bool with given probability p (0..1) */
	public nextBool(p = 0.5): boolean {
				if (p <= 0) return false;
		if (p >= 1) return true;
		return this.next() < p;
	}

	/** Pick a random element from arr (non-empty) */
	public pick<T>(arr: readonly T[]): T {
		const index = (Math.floor(this.next() * arr.length) | 0);
		return arr[index];
	}

	/** Fisher-Yates shuffle of a new copy */
	public shuffle<T>(arr: readonly T[]): T[] {
		const clone = [...arr] as T[];
		let i = arr.length;
		while (i > 1) {
			i -= 1;
			const j = Math.floor(this.next() * i) | 0;
			const tmp = clone[i];
		 clone[i] = clone[j];
		 clone[j] = tmp;
		}
		return clone;
	}

	/** Return a new independent instance derived from current state */
	public fork(): SeededRng {
		// Save state before advancing next32()
		const saveA = this.a;
		this.next32(); // advance parent state
		// Create fork with current state (not mutated)
		const forked = new SeededRng(saveA);
		forked.b = this.b;
		forked.c = this.c;
		// Now both have advanced, so fork's next will differ from parent's next
		return forked;
	}
}