import lodat, { Entity } from "./index";

const db = lodat({
  schemas: {
    todos: true,
  },
});

interface Person extends Entity {
  name: string;
}

db.exec(function* ({ schema, todos }) {
  const personSchema = schema("person");
  const persons: Person[] = yield personSchema.all((e) => e.key === "aaa");
  const person = yield personSchema.get("xasdasd");
  console.log(todos.get("aaa"), person);
  persons.forEach((person) =>
    personSchema.update(person, {
      name: "string",
    })
  );
});
