import { createAlgorithmPlatformService } from "../algorithmPlatformService";
import type { AlgorithmPlatformRepository, AlgorithmPlatformStore } from "../algorithmPlatformStore";

/** 仅用于隔离测试：保留真实业务服务，串行事务并在异常时回滚内存资料。 */
export function createAlgorithmPlatformFixture() {
  let state = { products: [] as { id: string; ownerId: number }[], versions: [] as any[], requests: [] as any[], orders: [] as any[], events: [] as any[] };
  let pending: Promise<unknown> = Promise.resolve();
  /** 构造与MySQL相同的资料库边界，测试不能跳过业务校验。 */
  const repository = (): AlgorithmPlatformRepository => ({
    claimProduct: async (id, ownerId) => {
      const existing = state.products.find(row => row.id === id);
      if (existing) return existing.ownerId;
      state.products.push({ id, ownerId }); return ownerId;
    },
    versions: async () => [...state.versions].reverse(),
    versionsForProduct: async id => state.versions.filter(row => row.productId === id),
    version: async id => state.versions.find(row => row.id === id),
    insertVersion: async value => { const id = state.versions.length + 1; state.versions.push({ createdAt: new Date(), ...value, id }); return id; },
    updateVersion: async (id, value) => { Object.assign(state.versions.find(row => row.id === id), value); },
    requests: async () => [...state.requests].reverse(), request: async id => state.requests.find(row => row.id === id),
    requestByKey: async (customerId, key) => state.requests.find(row => row.customerId === customerId && row.idempotencyKey === key),
    insertRequest: async value => { const id = state.requests.length + 1; state.requests.push({ createdAt: new Date(), ...value, id }); return id; },
    updateRequest: async (id, value) => { Object.assign(state.requests.find(row => row.id === id), value); },
    orders: async customerId => [...state.orders].reverse().filter(row => customerId === undefined || row.customerId === customerId),
    order: async id => state.orders.find(row => row.id === id),
    orderForRequest: async id => state.orders.find(row => row.requestId === id),
    insertOrder: async value => { const id = state.orders.length + 1; state.orders.push({ createdAt: new Date(), ...value, id }); return id; },
    updateOrder: async (id, value) => { Object.assign(state.orders.find(row => row.id === id), value); },
    customers: async () => [{ id: 42, name: "测试客户" }], audit: async value => { state.events.push(value); },
  });
  const store: AlgorithmPlatformStore = {
    read: run => run(repository()),
    transaction(run) {
      const task = pending.then(async () => {
        const before = structuredClone(state);
        try { return await run(repository()); } catch (error) { state = before; throw error; }
      });
      pending = task.catch(() => undefined);
      return task;
    },
  };
  const service = createAlgorithmPlatformService(store, { financeUsers: new Set([2]), now: () => new Date("2026-10-21T00:00:00Z") });
  return { service, store, state: () => state };
}
