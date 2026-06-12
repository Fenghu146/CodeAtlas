declare module 'chokidar' {
  interface WatchOptions {
    ignored?: string | string[];
    persistent?: boolean;
    ignoreInitial?: boolean;
    followSymlinks?: boolean;
    cwd?: string;
    disableGlobbing?: boolean;
    usePolling?: boolean;
    interval?: number;
    binaryInterval?: number;
    alwaysStat?: boolean;
    depth?: number;
    awaitWriteFinish?: boolean | { stabilityThreshold?: number; pollInterval?: number };
    ignorePermissionErrors?: boolean;
    atomic?: boolean | number;
  }

  interface FSWatcher {
    on(event: string, listener: (...args: any[]) => void): FSWatcher;
    close(): Promise<void>;
  }

  function watch(paths: string | string[], options?: WatchOptions): FSWatcher;
  export default { watch };
}
