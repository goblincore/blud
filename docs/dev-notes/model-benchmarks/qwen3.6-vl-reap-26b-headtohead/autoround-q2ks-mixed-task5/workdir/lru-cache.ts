class LRUNode<K, V> {
	public next: LRUNode<K, V> | null = null;
	public prev: LRUNode<K, V> | null = null;
	constructor(
		public readonly key: K,
		public value: V,
	) {}
	public remove(): void {
		if (this.prev) this.prev.next = this.next;
		if (this.next) this.next.prev = this.prev;
	}
}

export class LRUCache<K, V> {
	private readonly capacity: number;
	private readonly map: Map<K, LRUNode<K, V>>;
	private head: LRUNode<K, V> | null;
	private tail: LRUNode<K, V> | null;

	constructor(capacity: number) {
		this.capacity = capacity;
		this.map = new Map();
		this.head = new LRUNode(null as any, null as any);
		this.tail = new LRUNode(null as any, null as any);
		this.head.next = this.tail;
		this.tail.prev = this.head;
	}

	public get(key: K): V | undefined {
		const node = this.map.get(key);
		if (!node) {
			return undefined;
		}
		this.moveToHead(node);
		return node.value;
	}

	public set(key: K, value: V): void {
		let node = this.map.get(key);
		if (node) {
			node.value = value;
			this.moveToHead(node);
			return;
		}

		const newNode = new LRUNode(key, value);
		this.map.set(key, newNode);
		this.moveToHead(newNode);

		// Evict LRU (tail's prev) if over capacity
		if (this.map.size > this.capacity) {
			const lru = this.tail!.prev;
			// Remove from linked list
			lru!.prev.next = lru.next;
			lru.next.prev = lru.prev;
			// Remove from map
			this.map.delete(lru.key);
		}
	}

	public has(key: K): boolean {
		return this.map.has(key);
	}

	public delete(key: K): boolean {
		const node = this.map.get(key);
		if (!node) {
			return false;
		}
		// Remove from linked list
		node.remove();
		// Remove from map
		this.map.delete(key);
		return true;
	}

	public get size(): number {
		return this.map.size;
	}

	public entries(): IterableIterator<[K, V]> {
		const iter = {
			current: this.head.next,
			count: this.map.size,
			next() {
				if (this.current === null) {
					return { done: true, value: undefined };
				}
				const { key, value } = this.current;
				this.current = this.current.next;
				const result: [K, V] | undefined = [key, value];
				this.count--;
				return { done: false, value: result };
			},
			[Symbol.iterator]() {
				return this;
			},
		};
		return iter;
	}

	private moveToHead(node: LRUNode<K, V>): void {
		node.remove();
		node.next = this.head.next;
		this.head.next = node;
		node.next.prev = node;
	}
}
