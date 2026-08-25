// Central tunables. Units: metres, seconds, radians.

export const PALETTE = {
  skyTop: 0x8fc4e8,
  skyHorizon: 0xdfeef8,
  haze: 0xdcebf6,
  snowLit: 0xf4f9fd,
  sun: 0xfff4e2,
  treeDark: 0x2c6b48,
  treeLight: 0x3d8a5c,
  treeSnow: 0xf6fbff,
  trunk: 0x6b4a33,
  cabinWall: 0xa8663c,
  cabinDark: 0x7d4326,
  cabinWindow: 0xffc861,
  rock: 0x6d7f92,
  farMountainSnow: 0xeaf4fd,
  farMountainRock: 0x5f92c8,
  farMountainDeep: 0x3f6ea8,
  farForest: 0x35648d,
  jacket: 0xd94a2c,
  jacketAlt: 0xef7a2a,
  pants: 0x27324c,
  beanie: 0xf5b431,
  beanieStripe: 0x2f5aa8,
  pom: 0xf4f7fb,
  board: 0x2f5aa8,
  skin: 0xe0a075,
};

export const SLOPE = {
  grade: 0.30,        // tan of the average fall line
  halfWidth: 36,      // groomed corridor half-width
  bankHeight: 24,     // asymptotic rise of the valley sides
};

export const PHYSICS = {
  gravity: 19.6,      // exaggerated for a snappier arcade feel
  baseDrag: 0.011,    // quadratic air drag -> ~68 km/h cruise on the fall line
  tuckDrag: 0.0062,   // ~92 km/h tucked
  edgeFriction: 0.55, // speed bleed when carving hard
  flatFriction: 0.09,
  maxSpeed: 34,
  turnRate: 1.55,     // rad/s at full carve
  ollie: 9.0,
  spinRate: 8.0,      // rad/s at full wind-up — a full 360 fits in a good ollie
};

export const CHUNK = {
  length: 64,         // metres of fall line per chunk
  rows: 48,           // z subdivisions
  cols: 96,           // x subdivisions
  halfSpan: 150,      // metres to either side
  count: 9,           // chunks kept alive
  behind: 1,          // how many are kept behind the rider
};

export const CAMERA = {
  distance: 9.2,
  height: 3.15,
  lookAhead: 9.0,
  baseFov: 58,
  speedFov: 12,       // extra fov at max speed
  stiffness: 5.2,
  headingFollow: 0.5,  // how much of the board's yaw the camera adopts
};

export const FOG_NEAR = 90;
export const FOG_FAR = 520;
