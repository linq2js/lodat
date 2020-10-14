# lodat (Local Database)

Powerful persistent store for Javascript.
Compatible with (localStorage, sessionStorage, AsyncStorage, and many more)

## Installation

```
npm install lodat --save
```

## Getting started

Making a simple counter app using Lodat

```jsx
import lodat from "lodat";

// create lodat db with some options
const db = lodat({
  // by default, lodat stores data in memory
  // in this case, we want to store data in localStorage,
  // of course, we can specify other storages: sessionStorage, AsyncStorage or customized storage
  storage: localStorage,
  // specify initial data
  initial: { count: 1 },
  // this action will be called after db created
  // note: this is a functional generator, we will take a look at this later on (please refer Generator Function)
  *init() {
    render();
  },
});
// handle db updating
db.subscribe(render);

function* getCount({ get }) {
  return yield get("count");
}

function* increase({ set }) {
  yield set("count", (prev) => prev + 1);
}

async function render() {
  const count = await db.exec(getCount);
  document.body.innerHTML = `<h1>Counter: ${count}</h1>`;
}

setInterval(() => {
  db.exec(increase);
}, 1000);
```

## Using schema

```jsx
import lodat from "lodat";

const db = lodat({
  schemas: {
    // "todos" is context prop name, its map to "todo" schema
    todos: "todo",
  },
});

function* addTodo(context) {
  return yield context.todos.create({ title: "new todo" });
}

function* removeTodo(context, key) {
  yield context.todos.remove(key);
}

const newTodo = await db.exec(addTodo);

db.exec(removeTodo, newTodo.key);
```

## Querying entity

```jsx
function* getCompletedTodos(context) {
  return yield context.todos.all((todo) => todo.completed);
}

function* getFirstCompletedTodos(context) {
  return yield context.todos.get((todo) => todo.completed);
}

function* getTodoByKey(context, key) {
  return yield context.todos.get(key);
}
```

## Examples

1. [Todo App](https://codesandbox.io/s/lodat-todo-cmrod?file=/src/index.js)

## Performance testing (TBD)

## References

### lodat(options)

- options:

  | name     | type                                      | description                                              |
  | :------- | ----------------------------------------- | -------------------------------------------------------- |
  | name     | string                                    | database name (def = '')                                 |
  | storage  | Storage object                            | specify storage type will be used (def = memoryStorage)  |
  | debounce | number                                    | specify writing debouncing (def = 0, no debouncing)      |
  | initial  | any                                       | specify default data                                     |
  | init     | [Generator Function](#generator-function) | specify an action will be executed in initializing phase |
  | schemas  | string[]                                  | list of schema names                                     |
  | schemas  | { prop: 'schema name' }                   | schema mappings                                          |

- **Return:** [Database](#database-props) instance

### Database props

| name                     | return               | description                                                                                            |
| :----------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| exec(executor, payload?) | Promise              | execute an executor with specified payload. Executor must be [Generator Function](#generator-function) |
| subscribe(listener)      | Unsubscribe function | add a change listener. It will be called any time an data manipulated                                  |
| clear()                  | void                 | clear all data                                                                                         |
| flush()                  | void                 | flush all pending writes to storage                                                                    |

### Context props

| name                     | type/return                    | description                                                                                                                             |
| :----------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| schema(name)             | [Schema](#schema-props) object | get specified schema by its name                                                                                                        |
| get(name)                | Yield<any>                     | get value of specified database prop                                                                                                    |
| set(name, value)         | Yield<void>                    | set value of specified database prop                                                                                                    |
| set(name, reducerFn)     | Yield<void>                    | set value of specified database prop using **reducerFn**, the **reducerFn** retrieves previous value as first argument                  |
| exec(executor, payload?) | Yield<void>                    | execute an executor with specified payload. Executor must be [Generator Function](#generator-function)                                  |
| fork(executor, payload?) | Yield<void>                    | execute an executor with specified payload and dont block current execution. Executor must be [Generator Function](#generator-function) |

### Schema props

| name                    | type/return          | description                                                                              |
| :---------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| name                    | string               | schema name                                                                              |
| create(props)           | Yield<Entity>        | create new entity with specified props                                                   |
| exist(entityKey)        | Yield<bool>          | check entity existing by its key                                                         |
| remove(...entityKeys)   | Yield<void>          | remove multiple entities by their keys                                                   |
| count()                 | Yield<number>        | return a number of entity in the schema                                                  |
| all()                   | Yield<Entity[]>      | return all entities in the schema                                                        |
| all(limit)              | Yield<Entity[]>      | return first N entities in the schema                                                    |
| all(entityKeys)         | Yield<Entity[]>      | return all entities that matches given keys                                              |
| all(predicateFn)        | Yield<Entity[]>      | return all entities that matches given **predicateFn**                                   |
| all(predicateFn, limit) | Yield<Entity[]>      | return first N entities that matches given **predicateFn**                               |
| get(entityKey)          | Yield<Entity>        | get entity by key                                                                        |
| get(predicateFn)        | Yield<Entity>        | get first entity that matches given **predicateFn**                                      |
| clear()                 | Yield<void>          | clear all entities in the schema                                                         |
| update(entity, props)   | Yield<void>          | update specified entity with new props, if no props changed, nothing to write to storage |
| subscribe(listener)     | Unsubscribe function | add a change listener. It will be called any time an entity manipulated                  |

### Generator Function

Lodat uses generator function to control reading or writing data flows and async execution (no async/await needed).
Below is simple generator function.

```jsx
function* generatorFunction(generatorContext, payload) {
  // a generatorContext provides many util methods, please refer Context props section for further info
  // retrieve return value from yield expression
  const returnValueOfDoSomething = yield generatorContext.doSomething(payload);
  // retrieve resolved value from promise
  const resolvedValue = yield ApiCall(payload);
}
```
