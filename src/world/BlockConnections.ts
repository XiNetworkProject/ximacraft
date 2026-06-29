export type BlockConnectionState = {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
};

export const NO_CONNECTIONS: BlockConnectionState = {
  north: false,
  south: false,
  east: false,
  west: false,
};
