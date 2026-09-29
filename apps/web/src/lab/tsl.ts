/**
 * tsl.ts — LOOSELY TYPED re-export of three/tsl.   (FOUNDATION-OWNED)
 *
 * The r171 @types for TSL are too strict for compute kernels (Fn returning void, .compute(), .toAttribute() and storage
 * `.value` are all typed wrong or missing). Every lab file imports TSL from HERE instead of 'three/tsl' so the web
 * typecheck stays green; everything is `any`. If you need a TSL export that is not listed, add its name to NAMES-style
 * exports at the bottom (or use `T.name`).
 */
import * as TSL from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const A: any = TSL;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const T: any = A;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Fn: any = A.Fn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const If: any = A.If;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Loop: any = A.Loop;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Break: any = A.Break;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Continue: any = A.Continue;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const instancedArray: any = A.instancedArray;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const attributeArray: any = A.attributeArray;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const storage: any = A.storage;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const instanceIndex: any = A.instanceIndex;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalId: any = A.globalId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const workgroupId: any = A.workgroupId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localId: any = A.localId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const invocationLocalIndex: any = A.invocationLocalIndex;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uniform: any = A.uniform;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vec2: any = A.vec2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vec3: any = A.vec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vec4: any = A.vec4;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const float: any = A.float;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const int: any = A.int;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uint: any = A.uint;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bool: any = A.bool;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const color: any = A.color;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ivec2: any = A.ivec2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ivec3: any = A.ivec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uvec2: any = A.uvec2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uvec3: any = A.uvec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hash: any = A.hash;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const select: any = A.select;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const exp: any = A.exp;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const exp2: any = A.exp2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const log: any = A.log;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const log2: any = A.log2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sqrt: any = A.sqrt;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inverseSqrt: any = A.inverseSqrt;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const smoothstep: any = A.smoothstep;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const step: any = A.step;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const oneMinus: any = A.oneMinus;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const abs: any = A.abs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sign: any = A.sign;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const floor: any = A.floor;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ceil: any = A.ceil;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fract: any = A.fract;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mod: any = A.mod;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const max: any = A.max;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const min: any = A.min;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const clamp: any = A.clamp;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const saturate: any = A.saturate;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mix: any = A.mix;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pow: any = A.pow;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cos: any = A.cos;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sin: any = A.sin;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tan: any = A.tan;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const atan: any = A.atan;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const acos: any = A.acos;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const asin: any = A.asin;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const normalize: any = A.normalize;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const length: any = A.length;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const distance: any = A.distance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dot: any = A.dot;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cross: any = A.cross;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const reflect: any = A.reflect;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const negate: any = A.negate;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lengthSq: any = A.lengthSq;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PI: any = A.PI;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PI2: any = A.PI2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EPSILON: any = A.EPSILON;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const time: any = A.time;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const deltaTime: any = A.deltaTime;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const frameId: any = A.frameId;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const uv: any = A.uv;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const screenUV: any = A.screenUV;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const screenSize: any = A.screenSize;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const texture: any = A.texture;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pass: any = A.pass;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const renderOutput: any = A.renderOutput;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_noise_float: any = A.mx_noise_float;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_noise_vec3: any = A.mx_noise_vec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_fractal_noise_float: any = A.mx_fractal_noise_float;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_fractal_noise_vec3: any = A.mx_fractal_noise_vec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_worley_noise_float: any = A.mx_worley_noise_float;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mx_worley_noise_vec3: any = A.mx_worley_noise_vec3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const triNoise3D: any = A.triNoise3D;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const positionLocal: any = A.positionLocal;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const positionWorld: any = A.positionWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cameraPosition: any = A.cameraPosition;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cameraViewMatrix: any = A.cameraViewMatrix;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cameraProjectionMatrix: any = A.cameraProjectionMatrix;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const attribute: any = A.attribute;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const varying: any = A.varying;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vertexColor: any = A.vertexColor;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const rotate: any = A.rotate;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const billboarding: any = A.billboarding;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pointUV: any = A.pointUV;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toneMapping: any = A.toneMapping;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remap: any = A.remap;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const remapClamp: any = A.remapClamp;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hue: any = A.hue;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const saturation: any = A.saturation;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const luminance: any = A.luminance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const vibrance: any = A.vibrance;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lumaCoeffs: any = A.lumaCoeffs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const cond: any = A.cond;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const convertToTexture: any = A.convertToTexture;
