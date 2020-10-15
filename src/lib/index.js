const noop = () => {};

const allSchemasKey = "schemas";

function schemaStorageKey(context, schemaName) {
  return `${context.name}/${schemaName}/keys`;
}

function entityStorageKey(key) {
  return "#" + key;
}

export default function lodat({
  name = "",
  init,
  debounce = 0,
  storage = memoryStorage,
  // defaultSchema = "*",
  initial,
  schemas,
} = {}) {
  const context = {
    name: "",
    debounce,
    defaultSchema: "__def",
    initial,
    definitions: {},
    storage: createStorageWrapper(name, storage),
    schemas: {},
    promises: {},
    executionScopes: 0,
    writes: [],
    schema,
    flush,
    onUpdate: createEventSource(),
    subscribe,
    clear,
    get,
    set,
    exec(generator, payload) {
      return new Command(generator, { payload });
    },
    fork(generator, payload) {
      return new Command(generator, { fork: true, payload });
    },
  };

  function clear() {
    Object.values(context.schemas).forEach((schema) => schema.clear());
    context.onUpdate.notify({ type: "clear" });
  }

  function flush() {
    clearTimeout(context.flushTimerId);
    return flushWrites(context, true);
  }

  function subscribe(subscription) {
    return context.onUpdate.add(subscription);
  }

  function exec(generator, payload, callback) {
    let resolved = false;
    let promiseResolve = undefined;
    let returnValue = undefined;

    function callbackWrapper(result) {
      resolved = true;
      returnValue = result;
      promiseResolve && promiseResolve(result);
    }

    handleGenerator({
      payload,
      callback: callbackWrapper,
      generator: context.schemasReady
        ? generator
        : function* () {
            yield context.__loadAllSchemaCommand;
            return yield new Command(generator, { payload });
          },
      context,
    });
    if (resolved) return returnValue;
    if (typeof callback !== "function") {
      return new Promise((resolve) => (promiseResolve = resolve));
    } else {
      promiseResolve = callback;
    }
  }

  function schema(name) {
    return getSchema(context, name);
  }

  context.__loadAllSchemaCommand = new Command(loadAllSchemas);

  if (typeof init === "function") {
    exec(init);
  }

  if (schemas) {
    const entries = Array.isArray(schemas)
      ? schemas.map((x) => {
          if (typeof x === "string") {
            return [x, { name: x }];
          }
          if (typeof x === "object") {
            return [x.name, x];
          }
          throw new Error("Invalid schema definition. " + typeof x);
        })
      : Object.entries(schemas).map(([prop, x]) => {
          if (typeof x === "string") {
            return [prop, { name: x }];
          }
          if (typeof x === "object") {
            return [prop, x];
          }
          if (x === true) {
            return [prop, { name: prop }];
          }
          throw new Error("Invalid schema definition. " + typeof x);
        });

    entries.forEach(([prop, schemaDef]) => {
      context.definitions[schemaDef.name] = schemaDef;
      Object.defineProperty(context, prop, {
        get() {
          return context.schema(schemaDef.name);
        },
      });
    });
  }

  return {
    exec,
    subscribe,
    clear,
    flush,
  };
}

export function createMemoryStorage(isAsync) {
  if (isAsync) {
    const ms = createMemoryStorage();
    const performAsync = (fn) => {
      Promise.resolve().then(fn);
    };

    return {
      getItem() {
        performAsync(() => ms.getItem(...arguments));
      },
      setItem() {
        performAsync(() => ms.setItem(...arguments));
      },
      removeItem() {
        performAsync(() => ms.removeItem(...arguments));
      },
      clear() {
        performAsync(() => ms.clear(...arguments));
      },
      getAll() {
        performAsync(() => ms.getAll(...arguments));
      },
      multiGet() {
        performAsync(() => ms.multiGet(...arguments));
      },
      multiSet() {
        performAsync(() => ms.multiSet(...arguments));
      },
      multiRemove() {
        performAsync(() => ms.multiRemove(...arguments));
      },
    };
  }

  let storage = {};

  return {
    getItem(key, callback) {
      callback(null, storage[key]);
    },
    setItem(key, value, callback) {
      storage[key] = value;
      callback && callback();
    },
    removeItem(key, callback) {
      delete storage[key];
      callback && callback();
    },
    multiSet(entries, callback) {
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];
        storage[key] = value;
      }
      callback && callback();
    },
    multiGet(keys, callback) {
      callback(
        null,
        keys.map((key) => [key, storage[key]])
      );
    },
    multiRemove(keys, callback) {
      for (let i = 0; i < keys.length; i++) {
        delete storage[keys[i]];
      }
      callback && callback();
    },
    clear(callback) {
      storage = {};
      callback && callback();
    },
    getAll(callback) {
      return callback(null, storage);
    },
  };
}

export const memoryStorage = createMemoryStorage();

function getSchema(context, name, ids = []) {
  let schema = context.schemas[name];
  if (!schema) {
    schema = new Schema(context, name, new Set(ids), context.definitions[name]);
    context.schemas[name] = schema;
    writeSchemas(context);
  }
  return schema;
}

function get(prop) {
  return new Command(function* (context) {
    const schema = getSchema(context, context.defaultSchema);
    const key = `${schema.name}/data`;
    let entity;
    if (!schema.keys.size) {
      entity = yield schema.create(context.initial, key);
    } else {
      entity = yield schema.get(key);
    }
    return entity[prop];
  });
}

function set(prop, value) {
  return new Command(function* (context) {
    const schema = getSchema(context, context.defaultSchema);
    const key = `${schema.name}/data`;
    let entity;
    if (!schema.keys.size) {
      yield schema.create(
        {
          [prop]:
            typeof value === "function"
              ? value((context.initial || {})[prop])
              : value,
        },
        key
      );
    } else {
      entity = yield schema.get(key);
      yield schema.update(entity, {
        [prop]: typeof value === "function" ? value(entity[prop]) : value,
      });
    }
  });
}

function writeSchemas(context) {
  writeData(context, [
    "set",
    allSchemasKey,
    () => Object.keys(context.schemas).join("|"),
  ]);
}

function asyncCallback(fn) {
  return new Command(fn, { type: "callback" });
}

function* loadAllSchemas(context) {
  const schemaListString = yield asyncCallback((callback) =>
    context.storage.get(allSchemasKey, callback)
  );
  const schemaNames = schemaListString ? schemaListString.split("|") : [];
  yield schemaNames.map((schemaName) =>
    asyncCallback((callback) =>
      handleGenerator({
        generator: loadSchema,
        context,
        callback,
        payload: schemaName,
      })
    )
  );
  context.schemasReady = true;
}

function flushWrites(context, force) {
  function internalFlush() {
    if (!context.writes || !context.writes.length) return;
    const writes = context.writes;
    const actionsByKey = {};
    for (let i = 0; i < writes.length; i++) {
      const [action, key, value] = writes[i];
      actionsByKey[key] = [action, key, value];
    }
    const set = [];
    const remove = [];
    const keys = Object.keys(actionsByKey);
    for (let i = 0; i < keys.length; i++) {
      const [action, key, value] = actionsByKey[keys[i]];
      if (action === "set") {
        set.push([key, typeof value === "function" ? value() : value]);
      } else {
        remove.push(key);
      }
    }
    context.storage.set(set);
    context.storage.remove(remove);
    writes.length = 0;
  }

  if (force || !context.debounce) {
    internalFlush();
  } else {
    clearTimeout(context.flushTimerId);
    context.flushTimerId = setTimeout(internalFlush, context.debounce);
  }
}

function createStorageWrapper(dbName, storage) {
  const prefix = dbName ? `${dbName}/` : "/";
  if (storage !== memoryStorage) {
    // is async storage
    if (typeof storage.multiGet === "function") {
      // full api supported
    }
    // is local storage
    else if (!storage.multiSet) {
      storage = wrapLocalStorage(storage);
    }
  }

  return {
    get(key, callback) {
      if (Array.isArray(key)) {
        storage.multiGet(
          key.map((k) => `${prefix}${k}`),
          (e, data) => {
            return callback(data);
          }
        );
      } else {
        storage.getItem(`${prefix}${key}`, (e, data) => {
          return callback(data);
        });
      }
    },
    remove(key, callback) {
      if (Array.isArray(key)) {
        storage.multiRemove(
          key.map((k) => `${prefix}${k}`),
          callback
        );
      } else {
        storage.removeItem(`${prefix}${key}`, callback);
      }
    },
    set(key, value, callback) {
      if (Array.isArray(key)) {
        callback = value;
        storage.multiSet(
          key.map(([k, value]) => [
            `${prefix}${k}`,
            typeof value === "function" ? value() : value,
          ]),
          callback
        );
      } else {
        storage.setItem(
          `${prefix}${key}`,
          typeof value === "function" ? value() : value,
          callback
        );
      }
    },
  };
}

function wrapLocalStorage(storage) {
  return {
    getItem(key, callback) {
      callback(null, storage.getItem(key));
    },
    setItem(key, value, callback) {
      storage.setItem(key, value);
      callback && callback();
    },
    removeItem(key, callback) {
      storage.removeItem(key);
      callback && callback();
    },
    multiSet(entries, callback) {
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i];
        storage.setItem(key, value);
      }
      callback && callback();
    },
    multiGet(keys, callback) {
      return callback(
        null,
        keys.map((key) => [key, storage.getItem(key)])
      );
    },
    multiRemove(keys, callback) {
      for (let i = 0; i < keys.length; i++) {
        storage.removeItem(keys[i]);
      }
      callback && callback();
    },
  };
}

export function handleGenerator({
  payload,
  context,
  generator,
  collectValues,
  callback = noop,
  maxLength,
} = {}) {
  let iterator = generator(context, payload);
  const values = [];
  if (typeof iterator === "function") {
    iterator = iterator(context, payload);
  }

  function next(payload) {
    try {
      context.executionScopes++;
      const result = iterator.next(payload);
      if (isPromiseLike(result)) {
        throw new Error("Async Generator not supported");
      }

      if (result.done) {
        return callback(collectValues ? values : result.value);
      }

      if (isPromiseLike(result.value)) {
        return result.value.then(next);
      }

      if (result.value instanceof Command) {
        const command = result.value;
        if (command.type === "callback") {
          return command.generator(next);
        } else {
          return handleGenerator({
            context,
            ...command,
            callback(result) {
              return next(command.map ? command.map(result) : result);
            },
          });
        }
      }

      if (Array.isArray(result.value) && result.value[0] instanceof Command) {
        let doneCount = 0;
        const results = [];
        const commands = result.value;
        commands.forEach((command, index) => {
          function callback(result) {
            results[index] = result;
            doneCount++;
            if (doneCount >= commands.length) {
              next(command.map ? command.map(results) : results);
            }
          }
          if (command.fork) {
            handleGenerator({ context, ...command });
            callback(undefined);
          } else {
            if (command.type === "callback") {
              command.generator(callback);
            } else {
              handleGenerator({ context, ...command, callback });
            }
          }
        });
        return;
      }

      if (collectValues) {
        values.push(result.value);
        if (maxLength && values.length >= maxLength) {
          return callback(values);
        }
      }

      return next(result.value);
    } finally {
      context.executionScopes--;
      if (!context.executionScopes) {
        flushWrites(context);
      }
    }
  }

  if (iterator && typeof iterator.next === "function") {
    return next();
  }
  return callback(iterator);
}

export class Command {
  constructor(generator, options) {
    this.generator = generator;
    Object.assign(this, options);
  }
}

function isPromiseLike(obj) {
  return obj && typeof obj.then === "function";
}

function exist(schemaName, key) {
  return new Command(function (context) {
    const schema = context.schemas[schemaName];
    if (!schema) return false;
    return schema.keys.has(key);
  });
}

function* loadSchema(context, schemaName) {
  const idListString = yield asyncCallback((callback) =>
    context.storage.get(schemaStorageKey(context, schemaName), callback)
  );
  const schema = getSchema(
    context,
    schemaName,
    idListString ? idListString.split("|") : []
  );
  context.schemas[schemaName] = schema;
  delete context.promises[schemaName];
  return schema;
}

class Schema {
  constructor(context, name, Keys, definition) {
    this.definition = definition || {};
    this.context = context;
    this.name = name;
    this.keys = Keys;
    this.entityArray = [];
    this.entityMap = {};
    this.onUpdate = createEventSource();
  }

  subscribe(subscription) {
    return this.onUpdate.add(subscription);
  }

  add(id, entity) {
    this.keys.add(id);
    this.entityArray.push(entity);
    this.entityMap[id] = entity;
    writeSchema(this.context, this);
  }

  create(props, ...args) {
    if (typeof props === "undefined") {
      props = this.definition.default;
    }
    return create(this.name, props, ...args);
  }

  remove(...args) {
    return remove(this.name, ...args);
  }

  update(entity, props) {
    return update(entity, props);
  }

  all(...args) {
    return all(this.name, ...args);
  }

  get(...args) {
    return entity(this.name, ...args);
  }

  count(...args) {
    return count(this.name, ...args);
  }

  exist(...args) {
    return exist(this.name, ...args);
  }

  clear() {
    writeData(
      this.context,
      // remove schema
      ["remove", schemaStorageKey(this.context, this.name)],
      // remove entities
      ...Array.from(this.keys).map((key) => ["remove", key])
    );
    Object.assign(this, {
      keys: new Set(),
      entityArray: [],
      entityMap: {},
    });

    this.onUpdate.notify({ type: "clear", schema: this.name });
  }
}

function writeSchema(context, schema) {
  writeData(context, [
    "set",
    schemaStorageKey(context, schema.name),
    () => Array.from(schema.keys).join("|"),
  ]);
}

function writeData(context, ...actions) {
  context.writes.push(...actions);
  if (!context.executionScopes) {
    flushWrites(context);
  }
}

function create(schemaName, props, customKey) {
  return new Command(function (context) {
    const key = customKey || generateId(schemaName);
    const entity = new Entity(schemaName, key, props);
    const schema = getSchema(context, schemaName);
    schema.add(entity.key, entity);
    const event = { entity, type: "create", schema: schema.name };
    schema.onUpdate.notify(event);
    context.onUpdate.notify(event);
    writeSchema(context, schema);
    writeEntity(context, entity);
    return entity;
  });
}

function writeEntity(context, entity) {
  writeData(context, [
    "set",
    entityStorageKey(entity.key),
    () => JSON.stringify(entity._props),
  ]);
}

function update(entity, props) {
  return new Command(function (context) {
    const hasChange = Object.entries(props).some(
      ([key, value]) => value !== entity[key]
    );
    if (!hasChange) return;
    Object.assign(entity._props, props);
    Object.assign(entity, props);
    const event = { entity, type: "update", schema: entity._schema };
    context.schemas[entity._schema].onUpdate.notify(event);
    context.onUpdate.notify(event);
    writeEntity(context, entity);
  });
}

function all(schemaName, input, limit) {
  if (typeof input === "number") {
    limit = input;
    input = undefined;
  }
  const predicate = typeof input === "function" ? input : undefined;
  const entityKeys = predicate ? undefined : input;
  const options = {
    collectValues: true,
    maxLength: limit || 0,
  };
  return new Command(
    (context) => query(context, schemaName, entityKeys, predicate),
    options
  );
}

function count(schemaName) {
  return new Command(function (context) {
    const schema = context.schemas[schemaName];
    return schema ? schema.keys.size : 0;
  });
}

function entity(schemaName, input) {
  const predicate = typeof input === "function" ? input : undefined;
  const entityKeys = predicate ? undefined : [input];
  const options = {
    collectValues: true,
    maxLength: 1,
    map(result) {
      return result[0];
    },
  };
  return new Command(
    (context) => query(context, schemaName, entityKeys, predicate),
    options
  );
}

function remove() {
  if (typeof arguments[0] === "string") {
    const [schemaName, ...entityKeys] = arguments;
    return new Command(function (context) {
      const schema = context.schemas[schemaName];
      if (!schema) return;
      const removedKeys = [];
      for (let i = 0; i < entityKeys.length; i++) {
        const item = entityKeys[i];
        let key;
        if (item instanceof Entity) {
          if (item._schema !== schema) {
            throw new Error("Invalid schema");
          }
          key = item.key;
        } else {
          key = item;
        }
        if (schema.keys.delete(key)) {
          delete schema.entityMap[key];
          removedKeys.push(key);
        }
      }
      if (removedKeys.length) {
        schema.entityArray = schema.entityArray.filter(
          (x) => !removedKeys.includes(x.key)
        );
        const event = {
          type: "remove",
          schema: schema.name,
          keys: removedKeys,
        };
        writeSchema(context, schema);
        schema.onUpdate.notify(event);
        context.onUpdate.notify(event);
        writeData(
          context,
          ...removedKeys.map((id) => ["remove", entityStorageKey(id)])
        );
      }
    });
  }
}

function* query(context, schemaName, entityKeys, predicate) {
  const schema = context.schemas[schemaName];
  if (!schema) return;
  const yieldAll = !entityKeys && !predicate;
  const processedKeys = {};
  const filter = (entity) =>
    yieldAll ||
    (entityKeys && entityKeys.includes(entity.key)) ||
    (predicate && predicate(entity));
  for (let i = 0; i < schema.entityArray.length; i++) {
    const entity = schema.entityArray[i];
    processedKeys[entity.key] = true;
    if (filter(entity)) {
      yield entity;
    }
  }
  const unloadedKeys = Array.from(schema.keys).filter(
    (id) => !processedKeys[id]
  );
  if (unloadedKeys.length) {
    yield loadEntities(context, schemaName, unloadedKeys);
    for (let i = 0; i < unloadedKeys.length; i++) {
      const entity = schema.entityMap[unloadedKeys[i]];
      if (filter(entity)) {
        yield entity;
      }
    }
  }
}

async function loadEntities(context, schemaName, entityKeys) {
  const schema = context.schemas[schemaName];
  if (!schema) return;
  const loadingPromises = [];
  const unloadedEntityKeys = entityKeys.filter((id) => {
    if (schema.entityMap[id]) {
      return false;
    }
    if (context.promises[id]) {
      loadingPromises.push(context.promises[id]);
      return false;
    }
    return true;
  });

  if (unloadedEntityKeys.length) {
    const loadEntitiesPromise = new Promise((resolve) =>
      context.storage.get(
        unloadedEntityKeys.map((key) => entityStorageKey(key)),
        resolve
      )
    ).then((entityData) => {
      for (let i = 0; i < unloadedEntityKeys.length; i++) {
        const entityId = unloadedEntityKeys[i];
        // if (!entityData[i]) {
        //   // throw new Error(`Entity #${entityId} does not exist`);
        // }
        // console.log('entity', entityData)
        schema.add(
          entityId,
          new Entity(schemaName, entityId, JSON.parse(entityData[i][1]) || {})
        );
        delete context.promises[entityId];
      }
    });
    for (let i = 0; i < unloadedEntityKeys.length; i++) {
      context.promises[unloadedEntityKeys[i]] = loadEntitiesPromise;
    }
    loadingPromises.push(loadEntitiesPromise);
  }

  await Promise.all(loadingPromises);
}

function generateId() {
  let firstPart = (Math.random() * Date.now()) | 0;
  let secondPart = (Math.random() * Date.now()) | 0;
  firstPart = ("0000" + firstPart.toString(36)).slice(-4);
  secondPart = ("0000" + secondPart.toString(36)).slice(-4);
  return `${firstPart}${secondPart}`;
}

class Entity {
  constructor(schema, key, props = {}) {
    Object.defineProperties(this, {
      key: {
        value: key,
        writable: false,
      },
      _schema: { value: schema, writable: false },
      _props: {
        value: props,
      },
    });
    Object.assign(this, props);
  }

  toJSON() {
    return this.key;
  }
}

export function createEventSource() {
  const listeners = [];
  let newListeners;
  let removedListeners;
  return {
    add(listener) {
      let isActive = true;
      let container;
      if (newListeners) {
        container = newListeners;
        newListeners.push(listener);
      } else {
        listeners.push(listener);
      }
      return function remove() {
        if (!isActive) return;

        // still in notifying progress
        if (container && container === newListeners) {
          const index = container.indexOf(listener);
          container.splice(index, 1);
        } else if (removedListeners) {
          removedListeners.push(listener);
        } else {
          const index = listeners.indexOf(listener);
          listeners.splice(index, 1);
        }

        isActive = false;
        container = undefined;
        listener = undefined;
      };
    },
    clear() {
      listeners.length = 0;
    },
    notify(event) {
      if (!listeners.length) return;
      try {
        newListeners = [];
        removedListeners = [];
        for (let i = 0; i < listeners.length; i++) {
          listeners[i](event);
        }
      } finally {
        if (newListeners.length) {
          listeners.push(...newListeners);
        }

        if (removedListeners.length) {
          for (let i = 0; i < removedListeners.length; i++) {
            const index = listeners.indexOf(removedListeners[i]);
            listeners.splice(index, 1);
          }
        }
        newListeners.length = 0;
        newListeners = undefined;

        removedListeners.length = 0;
        removedListeners = undefined;
      }
    },
  };
}
