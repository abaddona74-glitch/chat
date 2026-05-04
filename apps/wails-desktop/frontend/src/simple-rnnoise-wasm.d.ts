declare module 'simple-rnnoise-wasm' {
  export class RNNoiseNode extends AudioWorkletNode {
    constructor(context: BaseAudioContext);
    static register(context: BaseAudioContext, assetData?: [string | URL, Promise<WebAssembly.Module>]): Promise<void>;
    update(keepalive?: boolean | string): void;
    onstatus: ((event: MessageEvent) => void) | null;
  }
}
