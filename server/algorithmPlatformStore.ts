import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { customers } from "../drizzle/schema";
import { algorithmProducts as products, algorithmProductVersions as versions, algorithmPurchaseRequests as requests,
  algorithmManualOrders as orders, algorithmPlatformEvents as events } from "../drizzle/algorithmPlatformSchema";

export type ProductVersion = typeof versions.$inferSelect;
export type PurchaseRequest = typeof requests.$inferSelect;
export type ManualOrder = typeof orders.$inferSelect;
export type NewVersion = typeof versions.$inferInsert;
export type NewRequest = typeof requests.$inferInsert;
export type NewOrder = typeof orders.$inferInsert;
export type NewEvent = typeof events.$inferInsert;

export interface AlgorithmPlatformRepository {
  claimProduct(id: string, ownerId: number): Promise<number>;
  versions(): Promise<ProductVersion[]>;
  versionsForProduct(id: string): Promise<ProductVersion[]>;
  version(id: number): Promise<ProductVersion | undefined>;
  insertVersion(value: NewVersion): Promise<number>;
  updateVersion(id: number, value: Partial<NewVersion>): Promise<void>;
  requests(): Promise<PurchaseRequest[]>;
  request(id: number): Promise<PurchaseRequest | undefined>;
  requestByKey(customerId: number, key: string): Promise<PurchaseRequest | undefined>;
  insertRequest(value: NewRequest): Promise<number>;
  updateRequest(id: number, value: Partial<NewRequest>): Promise<void>;
  orders(customerId?: number): Promise<ManualOrder[]>;
  order(id: number): Promise<ManualOrder | undefined>;
  orderForRequest(id: number): Promise<ManualOrder | undefined>;
  insertOrder(value: NewOrder): Promise<number>;
  updateOrder(id: number, value: Partial<NewOrder>): Promise<void>;
  customers(): Promise<{ id: number; name: string }[]>;
  audit(value: NewEvent): Promise<void>;
}
export interface AlgorithmPlatformStore {
  read<T>(run: (repository: AlgorithmPlatformRepository) => Promise<T>): Promise<T>;
  transaction<T>(run: (repository: AlgorithmPlatformRepository) => Promise<T>): Promise<T>;
}
type Connection = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select" | "insert" | "update">;

/** 所有写入复用事务连接；状态转换前锁定目标行，唯一键守住网络重试与版本身份。 */
function repository(connection: Connection): AlgorithmPlatformRepository {
  return {
    claimProduct: async (id, ownerId) => {
      await connection.insert(products).values({ id, ownerId }).onDuplicateKeyUpdate({ set: { id } });
      return (await connection.select().from(products).where(eq(products.id, id)).for("update"))[0].ownerId;
    },
    versions: () => connection.select().from(versions).orderBy(desc(versions.id)).limit(1000),
    versionsForProduct: id => connection.select().from(versions).where(eq(versions.productId, id)).for("update"),
    version: async id => (await connection.select().from(versions).where(eq(versions.id, id)).limit(1).for("update"))[0],
    insertVersion: async value => (await connection.insert(versions).values(value).$returningId())[0].id,
    updateVersion: async (id, value) => { await connection.update(versions).set(value).where(eq(versions.id, id)); },
    requests: () => connection.select().from(requests).orderBy(desc(requests.id)).limit(1000),
    request: async id => (await connection.select().from(requests).where(eq(requests.id, id)).limit(1).for("update"))[0],
    requestByKey: async (customerId, key) => (await connection.select().from(requests)
      .where(and(eq(requests.customerId, customerId), eq(requests.idempotencyKey, key))).limit(1).for("update"))[0],
    insertRequest: async value => (await connection.insert(requests).values(value).$returningId())[0].id,
    updateRequest: async (id, value) => { await connection.update(requests).set(value).where(eq(requests.id, id)); },
    orders: customerId => connection.select().from(orders).where(customerId === undefined ? undefined : eq(orders.customerId, customerId)).orderBy(desc(orders.id)).limit(1000),
    order: async id => (await connection.select().from(orders).where(eq(orders.id, id)).limit(1).for("update"))[0],
    orderForRequest: async id => (await connection.select().from(orders).where(eq(orders.requestId, id)).limit(1).for("update"))[0],
    insertOrder: async value => (await connection.insert(orders).values(value).$returningId())[0].id,
    updateOrder: async (id, value) => { await connection.update(orders).set(value).where(eq(orders.id, id)); },
    customers: () => connection.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isActive, true)).limit(1000),
    audit: async value => { await connection.insert(events).values(value); },
  };
}

/** 延迟取得正式数据库；缺少连接时明确失败，不回退成内存商城。 */
export function createSqlAlgorithmPlatformStore(): AlgorithmPlatformStore {
  return {
    async read(run) {
      const database = await getDb();
      if (!database) throw Object.assign(new Error("算法平台存储不可用。"), { code: "STORAGE_UNAVAILABLE", httpStatus: 503 });
      return run(repository(database));
    },
    async transaction(run) {
      const database = await getDb();
      if (!database) throw Object.assign(new Error("算法平台存储不可用。"), { code: "STORAGE_UNAVAILABLE", httpStatus: 503 });
      return database.transaction(connection => run(repository(connection)));
    },
  };
}
