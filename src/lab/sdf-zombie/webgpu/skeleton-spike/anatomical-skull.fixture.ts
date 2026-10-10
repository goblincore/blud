// src/lab/sdf-zombie/webgpu/skeleton-spike/anatomical-skull.fixture.ts
//
// THE REAL ANATOMICAL SKULL for the tests: public/assets/lab/anatomical-skull.glb read by hand (GLTFLoader decodes
// the atlas image through the DOM, and the tests have none), as the fourteen piece geometries loadAnatomicalSkull
// hands an AnatomicalSkullKit. A test's kit is built on the asset the game ships.
// @ts-expect-error — node:fs is available in the Vitest runtime
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SKULL_PIECES } from './anatomical-skull';

const bytes = readFileSync('public/assets/lab/anatomical-skull.glb');
const jsonLength = bytes.readUInt32LE(12);
/** The GLB's JSON chunk. */
export const anatomicalSkullGltf = JSON.parse(bytes.subarray(20,20+jsonLength).toString());
const gltf = anatomicalSkullGltf;
const binary = bytes.subarray(28+jsonLength);
const accessor = (index: number): number[] => {
  const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
  const dimensions = ({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[a.type]!;
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
  const result: number[] = [];
  for (let i=0;i<a.count;i++) for(let c=0;c<dimensions;c++) {
    const offset=(view.byteOffset??0)+(a.byteOffset??0)+i*(view.byteStride??size*dimensions)+c*size;
    result.push(a.componentType===5126 ? binary.readFloatLE(offset) : a.componentType===5125 ? binary.readUInt32LE(offset) : binary.readUInt16LE(offset));
  }
  return result;
};

/** The fourteen pieces in SKULL_PIECES order, each with position, normal, uv and an index, in the asset's assembled
 *  frame. New geometries every call: a kit disposes its source with itself. */
export function anatomicalSkullSource(): { id: string; geometry: THREE.BufferGeometry }[] {
  return SKULL_PIECES.map(id=> {
    const node = gltf.nodes.find((n:{name:string})=>n.name===id);
    const primitive = gltf.meshes[node.mesh].primitives[0];
    const geometry = new THREE.BufferGeometry();
    for(const [attribute,key,dim] of [['position','POSITION',3],['normal','NORMAL',3],['uv','TEXCOORD_0',2]] as const)
      geometry.setAttribute(attribute,new THREE.Float32BufferAttribute(accessor(primitive.attributes[key]),dim));
    geometry.setIndex(accessor(primitive.indices));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...(node.translation??[0,0,0])),
      new THREE.Quaternion(...(node.rotation??[0,0,0,1])),new THREE.Vector3(...(node.scale??[1,1,1])));
    geometry.applyMatrix4(matrix);
    return {id,geometry};
  });
}
