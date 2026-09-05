```typescript
export class ObjectPool<T> {
  private pool: T[] = [];
  private factory: () => T;
  private resetFn?: (t: T) => void;

  constructor(
    factory: () => T,
    resetFn?: (t: T) => void,
    initialSize: number = 0
  ) {
    this.factory = factory;
    this.resetFn = resetFn;
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.factory());
    }
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.factory();
  }

  release(t: T): void {
    if (this.resetFn) {
      this.resetFn(t);
    }
    this.pool.push(t);
  }

  drain(): T[] {
    const drained = [...this.pool];
    this.pool = [];
    return drained;
  }

  get size(): number {
    return this.pool.length;
  }
}
```
