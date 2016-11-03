import * as assert from "assert";
import {Context} from "../lib/Context";


describe("Context", () => {
  it("simple", async () => {
    const ctx = new Context();
    ctx.register({
      name: "hello",
      create() {
        return "world";
      }
    });

    const actual = await ctx.resolve("hello");
    assert.strictEqual(actual, "world");
  });

  it("dependency resolution", async () => {
    const ctx = new Context();
    ctx.register({
      name: "greeting",
      dependencies: ["name"],
      create([name]: [string]) { return `Hello, ${name}!`; },
    });
    ctx.register({
      name: "name",
      create() { return "world"; }
    });

    const actual = await ctx.resolve("greeting");
    assert.strictEqual(actual, "Hello, world!");
  });

  it("asynchronous creation", async () => {
    const ctx = new Context();
    ctx.register({
      name: "hello",
      async create() {
        await wait(20);
        return "world";
      }
    });

    const actual = await ctx.resolve("hello");
    assert.strictEqual(actual, "world");
  });

  it("transient lifetime", async () => {
    const ctx = new Context();
    let called = 0;
    ctx.register({
      name: "hello",
      async create() {
        called++;
        return "world";
      },
      lifetime: "transient",
    });

    const actual = await Promise.all([ctx.resolve("hello"), ctx.resolve("hello")]);
    assert.deepStrictEqual(actual, ["world", "world"]);
    assert.strictEqual(called, 2);
  });

  it("context lifetime", async () => {
    const ctx = new Context();
    let called = 0;
    ctx.register({
      name: "hello",
      async create() {
        called++;
        await wait(20);
        return "world";
      },
      lifetime: "context",
    });

    const actual = await Promise.all([ctx.resolve("hello"), ctx.resolve("hello")]);
    assert.deepStrictEqual(actual, ["world", "world"]);
    assert.strictEqual(called, 1);
  });

  it("singleton lifetime", async () => {
    const ctx = new Context();
    let called = 0;
    ctx.register({
      name: "hello",
      async create() {
        called++;
        await wait(20);
        return "world";
      },
      lifetime: "singleton",
    });

    const actual = await Promise.all([ctx.resolve("hello"), ctx.resolve("hello")]);
    assert.deepStrictEqual(actual, ["world", "world"]);
    assert.strictEqual(called, 1);
  });

  it("destroy", async () => {
    const ctx = new Context();
    let create = 0, destroy = 0;
    let instance: any = undefined;
    ctx.register({
      name: "hello",
      async create() {
        create++;
        return "world";
      },
      async dispose(v: any) {
        instance = v;
        destroy++;
      },
      lifetime: "context",
    });

    const actual = await ctx.resolve("hello");
    assert.strictEqual(actual, "world");
    assert.strictEqual(create, 1);
    assert.strictEqual(destroy, 0);

    await ctx.destroy();
    assert.strictEqual(instance, "world");
    assert.strictEqual(create, 1);
    assert.strictEqual(destroy, 1);
  });

  it("destroy order", async () => {
    const ctx = new Context();
    const check: string[] = [];
    ctx.register({
      name: "name",
      async create() { return "world"; },
      async dispose(v: any) {
        check.push("c");
        await wait(20);
        check.push("d");
      },
      lifetime: "context",
    });
    ctx.register({
      name: "greet",
      dependencies: ["name"],
      async create([name]: [string]) { return `Hello, ${name}!`; },
      async dispose(v: any) {
        check.push("a");
        await wait(20);
        check.push("b");
      },
      lifetime: "context",
    });

    const actual = await ctx.resolve("greet");
    assert.strictEqual(actual, "Hello, world!");

    await ctx.destroy();
    assert.deepStrictEqual(check, ["a", "b", "c", "d"]);
  });

  it("child context, transient", async () => {
    const ctx = new Context();
    ctx.register({
      name: "hello",
      create() {
        return "world";
      }
    });
    const child = ctx.childContext();

    const actual = await child.resolve("hello");
    assert.strictEqual(actual, "world");
  });

  it("child context, context", async () => {
    const ctx = new Context();
    ctx.register({
      name: "hello",
      create() {
        return {};
      },
      lifetime: "context",
    });
    const child1 = ctx.childContext();
    const child2 = ctx.childContext();

    const actual1 = await child1.resolve("hello");
    assert.deepStrictEqual(actual1, {});
    const actual2 = await child2.resolve("hello");
    assert.deepStrictEqual(actual2, {});
    assert.notStrictEqual(actual1, actual2);
  });

  it("child context, singleton", async () => {
    const ctx = new Context();
    ctx.register({
      name: "hello",
      create() {
        return {};
      },
      lifetime: "singleton",
    });
    const child1 = ctx.childContext();
    const child2 = ctx.childContext();

    const actual1 = await child1.resolve("hello");
    assert.deepStrictEqual(actual1, {});
    const actual2 = await child2.resolve("hello");
    assert.deepStrictEqual(actual2, {});
    assert.strictEqual(actual1, actual2);
  });
});

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    setTimeout(resolve, ms);
  });
}
