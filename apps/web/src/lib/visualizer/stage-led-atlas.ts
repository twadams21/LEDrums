import { DataTexture, Matrix4, MeshBasicMaterial, NearestFilter, NoColorSpace, RGBAFormat, DoubleSide } from 'three';
import { MAX_STAGE_HOOPS, MAX_STAGE_PIXELS_PER_HOOP, type StageHoopBinding } from './stage-binding';

/** One preallocated RGBA row per real hoop. Padding and missing channels stay zero, including
 * after a previously bright frame. Values keep Pixels' raw RGB/255 interpretation. */
export function createStageLedAtlas(hoops: readonly StageHoopBinding[]) {
  const width = Math.max(1, ...hoops.map((hoop) => hoop.count));
  const height = Math.max(1, hoops.length);
  if (height > MAX_STAGE_HOOPS || width > MAX_STAGE_PIXELS_PER_HOOP ||
    hoops.some((hoop) => !Number.isInteger(hoop.count) || hoop.count < 1 || !Number.isInteger(hoop.start) || hoop.start < 0)) {
    throw new Error('Stage LED atlas limit');
  }
  const data = new Uint8Array(width * height * 4);
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.colorSpace = NoColorSpace;
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  let disposed = false;
  return {
    texture, width, height,
    update(frame: Uint8Array | null) {
      if (disposed) return;
      // Clear the whole bounded allocation, not only the bytes present in this frame.
      data.fill(0);
      for (let row = 0; row < hoops.length; row++) {
        const hoop = hoops[row]!;
        for (let pixel = 0; pixel < hoop.count; pixel++) {
          const source = (hoop.start + pixel) * 3, target = (row * width + pixel) * 4;
          data[target] = frame?.[source] ?? 0;
          data[target + 1] = frame?.[source + 1] ?? 0;
          data[target + 2] = frame?.[source + 2] ?? 0;
          data[target + 3] = 255;
        }
      }
      texture.needsUpdate = true;
    },
    dispose() { if (!disposed) { disposed = true; texture.dispose(); } },
  };
}

export function createStageLedMaterial(atlas: ReturnType<typeof createStageLedAtlas>, row: number, hoop: StageHoopBinding, meshToDrum: Matrix4): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: 'white', toneMapped: false, side: DoubleSide });
  material.name = 'stage-live-led';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      stageAtlas: { value: atlas.texture }, stageAtlasWidth: { value: atlas.width }, stageAtlasHeight: { value: atlas.height },
      stageRow: { value: row }, stageCount: { value: hoop.count }, stagePhase: { value: hoop.phase },
      stageDirection: { value: hoop.direction }, stageMeshToDrum: { value: meshToDrum },
    });
    shader.vertexShader = `uniform mat4 stageMeshToDrum; varying vec3 vStagePosition;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStagePosition = (stageMeshToDrum * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `
      uniform sampler2D stageAtlas;
      uniform float stageAtlasWidth, stageAtlasHeight, stageRow, stageCount, stagePhase, stageDirection;
      varying vec3 vStagePosition;
      ${shader.fragmentShader}`.replace('#include <color_fragment>', `
      #include <color_fragment>
      float stageAngle = atan(-vStagePosition.z, vStagePosition.x);
      float stageTurn = fract(stageDirection * (stageAngle - stagePhase) / 6.283185307179586);
      float stagePixel = floor(stageTurn * stageCount + 0.5);
      // Rounded indices are in [0,count]. Avoid reciprocal-based mod(count,count),
      // which can return count on real GPUs and read the next (padded) texel.
      stagePixel = stagePixel >= stageCount ? 0.0 : stagePixel;
      diffuseColor.rgb = texture2D(stageAtlas, vec2((stagePixel + 0.5) / stageAtlasWidth, (stageRow + 0.5) / stageAtlasHeight)).rgb;
    `);
  };
  material.customProgramCacheKey = () => 'stage-led-atlas-v2';
  return material;
}
