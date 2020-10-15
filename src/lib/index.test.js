import lodat, {
  handleGenerator,
  Command,
  memoryStorage,
  createEventSource,
  createMemoryStorage,
} from "./index.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  memoryStorage.clear();
});

test("generator: return value", () => {
  const callback = jest.fn();
  handleGenerator({
    context: {},
    generator: function* () {
      yield 1;
      yield 2;
      yield 3;
      return 4;
    },
    collectValues: false,
    callback,
  });
  expect(callback).toBeCalledWith(4);
});

test("generator: collect values 1", () => {
  const callback = jest.fn();
  handleGenerator({
    context: {},
    generator: function* () {
      yield 1;
      yield 2;
      yield 3;
      return 4;
    },
    collectValues: true,
    callback,
  });
  expect(callback).toBeCalledWith([1, 2, 3]);
});

test("generator: collect values 2", async () => {
  const callback = jest.fn();
  handleGenerator({
    context: {},
    generator: function* () {
      yield new Command(function* () {
        yield delay(10);
      });
      yield 1;
      yield 2;
      yield 3;
      return 4;
    },
    collectValues: true,
    callback,
  });
  expect(callback).toBeCalledTimes(0);
  await delay(15);
  expect(callback).toBeCalledWith([1, 2, 3]);
});

test("generator: all", async () => {
  const callback = jest.fn();

  function* getData(data, ms) {
    yield delay(ms);
    return data;
  }

  handleGenerator({
    context: {},
    generator: function* () {
      return yield [
        new Command(() => getData(1, 10)),
        new Command(() => getData(2, 20)),
        new Command(() => getData(3, 5)),
      ];
    },
    collectValues: false,
    callback,
  });

  expect(callback).toBeCalledTimes(0);
  await delay(10);
  expect(callback).toBeCalledTimes(0);
  await delay(15);
  expect(callback).toBeCalledWith([1, 2, 3]);
});

test("create()", async () => {
  const db = lodat();
  await db.exec(function* ({ schema }) {
    const todos = schema("todo");
    const todo1 = yield todos.create({ title: "todo 1" });
    yield todos.create({ title: "todo 2" });
    expect(todo1.title).toBe("todo 1");
    const foundTodo = yield todos.get(todo1.key);
    expect(foundTodo).toBe(todo1);
    const todoCount = yield todos.count();
    expect(todoCount).toBe(2);
  });
  await delay(10);
});

test("update()", async () => {
  const db = lodat();
  const todo = await db.exec(function* ({ schema }) {
    return yield schema("todo").create({ title: "new todo" });
  });
  expect(todo.title).toBe("new todo");
  await db.exec(function* ({ schema }) {
    yield schema("todo").update(todo, { title: "updated title" });
  });
  expect(todo.title).toBe("updated title");
});

test("get(predicate)", async () => {
  const db = lodat();

  await db.exec(function* ({ schema }) {
    const todos = schema("todo");
    yield todos.create({ title: "1" });
    yield todos.create({ title: "2" });
    yield todos.create({ title: "3" });
  });

  const todo3 = await db.exec(function* ({ schema }) {
    return yield schema("todo").get((todo) => todo.title === "3");
  });

  expect(todo3.title).toBe("3");
});

test("all(predicate)", async () => {
  const db = lodat();

  await db.exec(function* ({ schema }) {
    const todos = schema("todo");
    yield todos.create({ completed: false });
    yield todos.create({ completed: true });
    yield todos.create({ completed: true });
  });

  const completedTodos = await db.exec(function* ({ schema }) {
    return yield schema("todo").all((todo) => todo.completed);
  });

  expect(completedTodos.length).toBe(2);
});

test("all(predicate, limit)", async () => {
  const db = lodat();

  await db.exec(function* ({ schema }) {
    const todos = schema("todo");
    yield todos.create({ completed: true });
    yield todos.create({ completed: true });
    yield todos.create({ completed: true });
  });

  const completedTodos = await db.exec(function* ({ schema }) {
    return yield schema("todo").all((todo) => todo.completed, 2);
  });

  expect(completedTodos.length).toBe(2);
});

test("all(limit)", async () => {
  const db = lodat();

  await db.exec(function* ({ schema }) {
    const todos = schema("todo");
    yield todos.create({ completed: true });
    yield todos.create({ completed: true });
    yield todos.create({ completed: true });
  });

  const completedTodos = await db.exec(function* ({ schema }) {
    return yield schema("todo").all(2);
  });

  expect(completedTodos.length).toBe(2);
});

test("event source", () => {
  const e = createEventSource();
  let c3 = undefined;
  e.add(function () {
    r1();
    r2();
    c3 = jest.fn();
    e.add(c3);
  });
  const c1 = jest.fn();
  const c2 = jest.fn();
  const r1 = e.add(c1);
  const r2 = e.add(c2);
  e.notify();
  expect(c1).toBeCalledTimes(1);
  expect(c2).toBeCalledTimes(1);
  expect(c3).toBeCalledTimes(0);
});

test("default schema", async () => {
  const db = lodat();

  function* getAppName({ get }) {
    return yield get("appName");
  }

  const value = await db.exec(getAppName);
  expect(value).toBeUndefined();
  await db.exec(function* ({ set }) {
    yield set("appName", "TodoApp");
  });
  const value2 = await db.exec(getAppName);
  expect(value2).toBe("TodoApp");
});

test("default values", async () => {
  const db = lodat({
    initial: {
      count: 1,
    },
  });

  const count = await db.exec(function* (context) {
    return yield context.get("count");
  });

  expect(count).toBe(1);
});

test("predefined schemas", async () => {
  const db = lodat({ schemas: { todos: "todo" } });
  await db.exec(function* ({ todos }) {
    expect(todos).not.toBeUndefined();
  });
});

test("async storage", async () => {
  const storage = createMemoryStorage(true);
  const options = {
    storage,
    initial: {
      count: 1,
    },
  };
  const db1 = lodat(options);

  function* increase({ set }) {
    yield set("count", (prev) => {
      return prev + 1;
    });
  }

  function* getCount({ get }) {
    return yield get("count");
  }

  await db1.exec(increase);
  await db1.exec(increase);
  await db1.exec(increase);

  const count1 = await db1.exec(getCount);

  expect(count1).toBe(4);

  const db2 = lodat(options);

  const count2 = await db2.exec(getCount);

  expect(count2).toBe(4);
});
