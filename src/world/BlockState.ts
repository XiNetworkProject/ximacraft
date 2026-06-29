import { BlockShape } from "./blockstate/BlockShape";
import { BlockOrientation } from "./blockstate/BlockOrientation";
import { BlockConnectionState, NO_CONNECTIONS } from "./BlockConnections";

export type BlockState = {
  shape: BlockShape;
  orientation: BlockOrientation;
  connections: BlockConnectionState;
};

export function createBlockState(shape: BlockShape = "cube", orientation: BlockOrientation = "none", connections = NO_CONNECTIONS): BlockState {
  return { shape, orientation, connections };
}
