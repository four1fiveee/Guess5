interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<any>>();

export function getCached<T>(key: string, ttl: number = 30000): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  const age = Date.now() - entry.fetchedAt;
  if (age > ttl) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    fetchedAt: Date.now(),
  });
}

export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}







