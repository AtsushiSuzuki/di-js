di
==

Manages component dependency and lifetime.

# Usage
``` sh
$ npm i --save @atsushi_suzuki/di
```

``` typescript
import {Context} from "@atsushi_suzuki/di";

const ctx = new Context();
ctx.registerContext("db", [], () => {
  return connectToDatabase();
});
ctx.registerContext("repository", ["db"], ([db]) => {
  return createRepository(db);
});

const repo = await ctx.resolve("repository");
```

# Features
## Dependency management
Resolves component dependency.

## Lifetime management
Manages component lifetime and destruction.

 * "singleton": one instance per registered context.
 * "context": one instance per resolving context.
 * "transient": one instance per resolve. no dispose.

## Create child context

```typescript
const ctx = new Context();
// register components

const app = express();
app.use((req, res, next) => {
  // create new context per request
  const child = ctx.createChild();
  req.ctx = child;
  res.on("end", () => {
    // dispose instances at end
    child.destroy();
  });
  next();
});

app.get("/hello", (req, res) => {
  // use per-request component
  res.end(req.ctx.resolve("component").hello());
});
```

# Usage
## new Context(name?: string)
create new context instance, optionally with name.

## interface Creator<T>
function to create component instance.

```typescript
interface Creator<T> {
  (this: Context, dependencies: any[], args: any[]): any|Promise<any>;
}
```

## interface Disposer<T>
function to destroy component instance.

```typescript
interface Disposer<T> {
  (this: Context, instance: T): void|Promise<void>;
}
```

## Context#registerTransient<T>(name: string, dependencies: string[], create: Creator<T>): void
register component of transient lifetime.

"transient": one instance per resolve. no dispose.

## Context#registerContext<T>(name: string, dependencies: string[], create: Creator<T>, dispose?: Disposer<T>): void
register component of context lifetime.

"context": one instance per resolving context.

## Context#registerSingleton<T>(name: string, dependencies: string[], create: Creator<T>, dispose?: Disposer<T>): void
register component of singleton lifetime.

"singleton": one instance per registered context.

## Context#registerValue<T>(name: string, value: T): void
register value as component.

## Context#resolve(name: string, ...args: any[]): Promise<any>
create or retrieve component instance.

## Context#childContext(name?: string): Context
create child context to create new resolving scope. 
