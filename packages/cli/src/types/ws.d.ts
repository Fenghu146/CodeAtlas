declare module 'ws' {
  import { EventEmitter } from 'events';
  import { Server as HttpServer } from 'http';
  import { Server as HttpsServer } from 'https';
  import { URL } from 'url';
  import { ZlibOptions, Zlib } from 'zlib';
  import { Duplex, DuplexOptions } from 'stream';

  // ... (simplified declarations)
  export class WebSocket extends EventEmitter {
    constructor(address: string | URL, options?: WebSocket.ClientOptions);
    constructor(address: string, options?: WebSocket.ClientOptions);
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readyState: number;
    send(data: any, cb?: (err?: Error) => void): void;
    send(data: any, options: { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean }, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;
    terminate(code?: number, reason?: string): void;
    ping(data?: any, mask?: boolean, cb?: (err?: Error) => void): void;
    pong(data?: any, mask?: boolean, cb?: (err?: Error) => void): void;
    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'ping', listener: (data: Buffer) => void): this;
    on(event: 'pong', listener: (data: Buffer) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: WebSocket.ServerOptions, callback?: () => void);
    constructor(options?: WebSocket.ServerOptions);
    on(event: 'connection', listener: (ws: WebSocket, request: any) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'headers', listener: (headers: string[], request: any) => void): this;
    on(event: 'listening', listener: () => void): this;
    close(cb?: (err?: Error) => void): void;
    handleUpgrade(request: any, socket: any, head: Buffer, cb: (ws: WebSocket, request: any) => void): void;
    shouldHandle(request: any): boolean;
    clients: Set<WebSocket>;
  }

  export namespace WebSocket {
    interface ServerOptions {
      port?: number;
      host?: string;
      server?: HttpServer | HttpsServer;
      noServer?: boolean;
      perMessageDeflate?: boolean | ZlibOptions;
      clientTracking?: boolean;
      verifyClient?: VerifyClientCallback | VerifyClientCallbackSync;
      handleProtocols?: (protocols: string[], request: any) => string | false;
      path?: string;
      noDelay?: boolean;
      backlog?: number;
      serverOptions?: any;
    }

    interface ClientOptions extends DuplexOptions {
      protocol?: string;
      followRedirects?: boolean;
      handshakeTimeout?: number;
      maxPayload?: number;
      maxRedirects?: number;
      origin?: string;
      agent?: any;
      headers?: Record<string, string>;
      family?: number;
      checkServerIdentity?(hostname: string, cert: any): boolean;
      rejectUnauthorized?: boolean;
      perMessageDeflate?: boolean | ZlibOptions;
      localAddress?: string;
      localPort?: number;
      host?: string;
      port?: number;
    }

    type VerifyClientCallback = (info: { origin: string; secure: boolean; req: any }, callback: (result: boolean, code?: number, message?: string) => void) => void;
    type VerifyClientCallbackSync = (info: { origin: string; secure: boolean; req: any }) => boolean;
  }

  export default WebSocket;
}
