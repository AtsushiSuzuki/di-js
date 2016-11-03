const debug = require("debug")("di");


/**
 * specify component lifetime.
 * "singleton": one instance per registered context.
 * "context": one instance per resolving context.
 * "transient": one instance per resolve. no dispose.
 */
export type Lifetime = "singleton"|"context"|"transient";

/**
 * function to create component instance.
 */
export interface Creator<T> {
  (this: Context, dependencies: any[], args: any[]): any|Promise<any>;
}

/**
 * function to destroy component instance.
 */
export interface Disposer<T> {
  (this: Context, instance: T): void|Promise<void>;
}

export interface RegistrationParams<T> {
  /** component name. */
  name: string;
  /** component lifetime. defaults to "transient".*/
  lifetime?: Lifetime;
  /** depending component names. */
  dependencies?: string[];
  /** function to create component instance */
  create: Creator<T>;
  /** function to destroy component instance. */
  dispose?: Disposer<T>;
}

interface Registration {
  name: string;
  lifetime: Lifetime;
  dependencies: string[];
  create: Creator<any>;
  dispose?: Disposer<any>;
  context: Context;
}

interface Instantiation {
  createPromise: Promise<any>;
  disposePromise: Promise<void>|null;
  registration: Registration;
  dependencies: Instantiation[];
  context: Context;
}

/**
 * Context manages component dependency and lifetime.
 */
export class Context {
  private parent: Context|null = null;
  private children: Context[] = [];
  private registrations: {[name: string]: Registration} = Object.create(null);
  private instances: {[name: string]: Instantiation} = Object.create(null);


  constructor(public name: string = "") {
  }


  private path() {
    const nodes: string[] = [];
    for (let ctx: Context|null = this; ctx !== null; ctx = ctx.parent) {
      nodes.unshift(ctx.name);
    }
    return nodes.join("/");
  }

  /**
   * register component of transient lifetime.
   * "transient": one instance per resolve. no dispose.
   */
  registerTransient<T>(name: string, dependencies: string[], create: Creator<T>) {
    this.register({
      name,
      lifetime: "transient",
      dependencies,
      create,
    });
  }

  /**
   * register component of context lifetime.
   * "context": one instance per resolving context.
   */
  registerContext<T>(name: string, dependencies: string[], create: Creator<T>, dispose?: Disposer<T>) {
    this.register({
      name,
      lifetime: "context",
      dependencies,
      create,
      dispose,
    });
  }

  /**
   * register component of singleton lifetime.
   * "singleton": one instance per registered context.
   */
  registerSingleton<T>(name: string, dependencies: string[], create: Creator<T>, dispose?: Disposer<T>) {
    this.register({
      name,
      lifetime: "singleton",
      dependencies,
      create,
      dispose,
    });
  }

  /**
   * register value as component.
   */
  registerValue<T>(name: string, value: T) {
    this.register({
      name,
      lifetime: "transient",
      create: () => value,
    });
  }

  /**
   * register component.
   */
  register<T>({name, lifetime, dependencies, create, dispose}: RegistrationParams<T>): void {
    if (typeof name !== "string") {
      throw new TypeError(`"name" must be string`);
    }
    if (lifetime !== "singleton" &&
        lifetime !== "context" &&
        lifetime !== "transient" &&
        Boolean(lifetime) !== false) {
      throw new TypeError(`"lifetime" must be one of "singleton", "context", "transient" or false`);
    }
    if (typeof create !== "function") {
      throw new TypeError(`"create" must be function`);
    }
    if (typeof dispose !== "function" && typeof dispose !== "undefined" && dispose !== null) {
      throw new TypeError(`"create" must be function, null or undefined`);
    }
    lifetime = lifetime || "transient";
    if (lifetime === "transient" && typeof dispose === "function") {
      throw new TypeError(`registration with lifetime "transient" cannot have dispose function`);
    }

    debug(`register ${this.path()}/${name}`);
    this.registrations[name] = {
      name,
      lifetime: lifetime,
      dependencies: Array.from(dependencies || []),
      create,
      dispose: dispose || undefined,
      context: this,
    };
  }

  /**
   * create or retrieve component instance.
   */
  resolve(name: string, ...args: any[]): Promise<any> {
    return this.resolveImpl(name, args).createPromise;
  }

  private resolveImpl(name: string, args: any[]): Instantiation {
    let reg: Registration|undefined;
    for (let ctx: Context|null = this; ctx !== null; ctx = ctx.parent) {
      if (name in ctx.registrations) {
        reg = ctx.registrations[name];
        break;
      }
    }
    if (!reg) {
      throw new Error(`registration not found: ${this.path()}/${name}`);
    }

    const ctx = (reg.lifetime === "singleton") ? reg.context : this;
    if ((reg.lifetime === "singleton" || reg.lifetime === "context") &&
        (name in ctx.instances)) {
      debug(`resolving ${this.path()}/${name} from cache at ${ctx.path()}/${name}`);
      return ctx.instances[name];
    }

    debug(`resolving ${this.path()}/${name} with new instance at ${ctx.path()}/${name}`);
    const inst = this.instantiate(ctx, reg, args);
    if (reg.lifetime === "singleton" || reg.lifetime === "context") {
      ctx.instances[name] = inst;
    }
    return inst;
  }

  private instantiate(ctx: Context, reg: Registration, args: any[]): Instantiation {
    debug(`  creating ${ctx.path()}/${reg.name} with dependencies: [${reg.dependencies.map((name) => `"${name}"`).join(", ")}]`);

    const deps = reg.dependencies.map((name) => ctx.resolveImpl(name, []));
    return {
      createPromise: (async () => {
        const dependencies = await Promise.all(deps.map((dep) => dep.createPromise));
        const instance = await reg.create.call(ctx, dependencies, args);
        debug(`  created ${ctx.path()}/${reg.name}: ${inspect(instance)}`);
        return instance;
      })(),
      disposePromise: null,
      registration: reg,
      dependencies: deps,
      context: ctx,
    };
  }

  /**
   * create child context to create new resolving scope.
   */
  childContext(name?: string): Context {
    const child = new Context(name || `child[${this.children.length}]`);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  /**
   * dispose all instantiated components.
   */
  async destroy(): Promise<void> {
    debug(`destroying ${this.path() || "/"}`);
    await Promise.all(this.children.map((ctx) => ctx.destroy()));
    await Promise.all(Object.keys(this.instances).map((name) => this.dispose(this.instances[name])));

    // TODO: unregister from parent's "children"
  }

  private dispose(inst: Instantiation): Promise<void> {
    if (inst.disposePromise) {
      return inst.disposePromise;
    } else {
      return inst.disposePromise = (async () => {
        const dependants = Object.keys(this.instances)
          .map((name) => this.instances[name])
          .filter((x) => x.dependencies.indexOf(inst) !== -1);

        debug(`  disposing ${inst.context.path()}/${inst.registration.name} with dependants: [${dependants.map((x) => `"${x.registration.name}"`).join(", ")}]`);
        
        await Promise.all(dependants.map((x) => this.dispose(x)));
        
        if (inst.registration.dispose) {
          await inst.registration.dispose.call(this, await inst.createPromise);
        }
      })();
    }
  }
}

function inspect(obj: any) {
  if (typeof obj === "object" && obj !== null && typeof obj.constructor === "function") {
    return `[object ${obj.constructor.name}]`;
  } else {
    return Object.prototype.toString.call(obj);
  }
}
