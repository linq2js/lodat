export interface Entity {
  readonly key: EntityKey;
}

export type Executor<TPayload, TReturn, TDefaultEntity = PlainObject> =
  | ((
      context: Context<TDefaultEntity>,
      payload?: TPayload
    ) => Generator<YieldExpression, TReturn, any>)
  | ((
      context: Context<TDefaultEntity>,
      payload?: TPayload
    ) => (...args: any[]) => Generator<YieldExpression, TReturn, any>);

export interface PlainObject {
  [key: string]: any;
}

export interface Database<TDefaultEntity = PlainObject> {
  exec<TPayload = any, TReturn = void>(
    executor: Executor<TPayload, TReturn, TDefaultEntity>
  ): Promise<TReturn>;
  subscribe(observer: Subscription<Entity>): Unsubscribe;
  flush(): void;
  clear(): void;
}

export type YieldExpression = Promise<any> | Command<any> | Command<any>[];

export type Predicate<TEntity = Entity> = (entity: TEntity) => boolean;

export type Command<T> = { __type: T };

export type SchemaName = string;

export type EntityKey = string;

export type Context<TDefaultEntity> = { [key: string]: Schema } & ContextApi<
  TDefaultEntity
>;

export interface ContextApi<TDefaultEntity> {
  schema<TEntity = Entity>(name: SchemaName): Schema<TEntity>;
  clear(): Command<void>;
  get<TProp extends keyof TDefaultEntity>(
    prop: TProp
  ): Command<TDefaultEntity[TProp]>;
  get(prop: string): Command<any>;
  set<TProp extends keyof TDefaultEntity>(
    prop: TProp,
    value:
      | ((prev: TDefaultEntity[TProp]) => TDefaultEntity[TProp])
      | TDefaultEntity[TProp]
  ): Command<void>;
  set(prop: string, value: ((prev: any) => any) | any): Command<void>;

  // subscribe(observer: Subscription<Entity>): Unsubscribe;
  // flush(): void;
  // clear(): void;
  exec<TPayload>(
    executor: Executor<TPayload, any>,
    payload?: TPayload
  ): Command<any>;
  fork<TPayload>(
    executor: Executor<TPayload, any>,
    payload?: TPayload
  ): Command<any>;
}

export interface Schema<TEntity = Entity> {
  remove(...entityKeys: EntityKey[]): Command<Promise<void>>;
  remove(...entities: TEntity[]): Command<Promise<void>>;
  create(props?: Partial<Omit<TEntity, "key">>): Command<TEntity>;
  exist(key: EntityKey): Command<boolean>;
  count(): Command<number>;
  all(): Command<TEntity[]>;
  all(limit: number): Command<TEntity[]>;
  all(keys: EntityKey[]): Command<TEntity[]>;
  all(keys: EntityKey[], limit: number): Command<TEntity[]>;
  all(predicate: Predicate<TEntity>): Command<TEntity[]>;
  get(key: EntityKey): Command<TEntity>;
  get(predicate: Predicate<TEntity>): Command<TEntity>;
  update(entity: TEntity, props: Omit<TEntity, "key">): Command<Promise<void>>;
  subscribe(observer: Subscription<TEntity>): Unsubscribe;
  clear(): Command<void>;
}

export interface Options<TDefaultEntity> {
  storage?: AsyncStorage | SyncStorage;
  /**
   * specific db name
   */
  name?: string;
  /**
   * specific schema name that used to store default entity
   */
  defaultSchema?: string;
  /**
   * specific debounce time for writing updated data to the storage
   */
  debounce?: number;

  init?: Executor<any, TDefaultEntity>;
}

export type Unsubscribe = () => void;

export type Subscription<TEntity> = (args: {
  schema: string;
  entity: TEntity;
  type: "create" | "remove" | "update";
}) => any;

export interface AsyncStorage {
  getItem(key: string, callback: Function): void;
  setItem(key: string, value: string, callback: Function): void;
  removeItem(key: string, callback: Function): void;
  multiGet?(keys: string[], callback: Function): void;
  multiSet?(entries: string[][], callback: Function): void;
  multiRemove?(keys: string[], callback: Function): void;
}

export interface SyncStorage {
  getItem(key: string): string;
  setItem(key: string, value: string): string;
  removeItem(key: string): void;
}

export interface SchemaDef {
  name: string;
}

export type SchemaDefinitions =
  | { [key: string]: string | true | SchemaDef }
  | SchemaDef[]
  | string[];

export default function lodat<
  TDefaultEntity = PlainObject,
  TSchemaMap = SchemaDefinitions
>(
  options?: Options<TDefaultEntity> | { schemas: SchemaDefinitions }
): Database<TDefaultEntity>;
