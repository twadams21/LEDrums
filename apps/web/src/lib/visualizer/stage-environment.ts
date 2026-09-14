import { PMREMGenerator, type WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A small, Stage-only procedural reflection environment. Never attached as visible geometry. */
export function createStageEnvironment(renderer: WebGLRenderer) {
  const room = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  try {
    const target = generator.fromScene(room, 0.04, 0.1, 100);
    let disposed = false;
    return { texture: target.texture, dispose() { if (!disposed) { disposed = true; target.dispose(); } } };
  } finally { room.dispose(); generator.dispose(); }
}
