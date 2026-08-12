interface RefreshState<TContext, TValue> {
  readonly context: TContext;
  readonly controller: AbortController;
  value: TValue | undefined;
  requested: boolean;
  promise: Promise<TValue> | undefined;
}

export interface McpCatalogRefreshState<TContext, TValue> {
  readonly context: TContext | undefined;
  readonly controller: AbortController | undefined;
  readonly value: TValue | undefined;
}

export interface McpCatalogRefreshOptions<TContext, TValue> {
  readonly sameContext: (current: TContext, next: TContext) => boolean;
  readonly isActive: () => boolean;
  readonly createUnavailableError: () => Error;
  readonly load: (
    context: TContext,
    controller: AbortController,
    signal: AbortSignal,
  ) => Promise<TValue>;
  readonly commit?: (value: TValue, previous: TValue | undefined) => void;
  readonly clearReason: string;
}

/**
 * Owns one generation-bound catalog's refresh lifecycle.
 *
 * Each context gets an isolated state record so an old in-flight refresh can
 * never observe the next generation's coalescing flag. A refresh publishes
 * only after its loader returns, cancellation is checked, and this state is
 * still current; callers therefore keep their previous complete value on any
 * failed or stale refresh.
 */
export class McpCatalogRefresh<TContext, TValue> {
  private readonly options: McpCatalogRefreshOptions<TContext, TValue>;
  private state: RefreshState<TContext, TValue> | undefined;

  constructor(options: McpCatalogRefreshOptions<TContext, TValue>) {
    this.options = options;
  }

  getState(): McpCatalogRefreshState<TContext, TValue> {
    return {
      context: this.state?.context,
      controller: this.state?.controller,
      value: this.state?.value,
    };
  }

  setContext(context: TContext): void {
    if (this.state !== undefined && this.options.sameContext(this.state.context, context)) {
      return;
    }
    this.clear();
    this.state = {
      context,
      controller: new AbortController(),
      value: undefined,
      requested: false,
      promise: undefined,
    };
  }

  clear(): void {
    const previous = this.state;
    this.state = undefined;
    previous?.controller.abort(new Error(this.options.clearReason));
  }

  request(signal?: AbortSignal): Promise<TValue> {
    const state = this.state;
    if (!this.options.isActive() || state === undefined) {
      return Promise.reject(this.options.createUnavailableError());
    }
    state.requested = true;
    if (state.promise !== undefined) {
      return state.promise;
    }
    const refresh = this.run(state, signal).finally(() => {
      if (state.promise === refresh) {
        state.promise = undefined;
      }
    });
    state.promise = refresh;
    return refresh;
  }

  private async run(state: RefreshState<TContext, TValue>, signal?: AbortSignal): Promise<TValue> {
    let latest = state.value;
    do {
      state.requested = false;
      latest = await this.refreshOnce(state, signal);
      const previous = state.value;
      state.value = latest;
      this.options.commit?.(latest, previous);
    } while (state.requested);
    if (latest === undefined) {
      throw this.options.createUnavailableError();
    }
    return latest;
  }

  private async refreshOnce(
    state: RefreshState<TContext, TValue>,
    signal?: AbortSignal,
  ): Promise<TValue> {
    if (!this.options.isActive() || this.state !== state) {
      throw this.options.createUnavailableError();
    }
    const refreshSignal =
      signal === undefined
        ? state.controller.signal
        : AbortSignal.any([state.controller.signal, signal]);
    refreshSignal.throwIfAborted();
    const value = await this.options.load(state.context, state.controller, refreshSignal);
    refreshSignal.throwIfAborted();
    if (!this.options.isActive() || this.state !== state) {
      throw this.options.createUnavailableError();
    }
    return value;
  }
}
