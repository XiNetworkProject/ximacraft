type EventMap = Record<string, unknown>;
type Handler<T> = (payload: T) => void;

export class EventBus<TEvents extends EventMap> {
  private readonly handlers = new Map<keyof TEvents, Set<Handler<TEvents[keyof TEvents]>>>();

  on<TKey extends keyof TEvents>(type: TKey, handler: Handler<TEvents[TKey]>): () => void {
    const bucket = this.handlers.get(type) ?? new Set();
    bucket.add(handler as Handler<TEvents[keyof TEvents]>);
    this.handlers.set(type, bucket);
    return () => bucket.delete(handler as Handler<TEvents[keyof TEvents]>);
  }

  emit<TKey extends keyof TEvents>(type: TKey, payload: TEvents[TKey]): void {
    this.handlers.get(type)?.forEach((handler) => handler(payload));
  }
}
