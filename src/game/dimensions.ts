// Real-world dimensions in metres. World space is 1 unit = 1 m, Y up.
// The court's long axis runs along X (baselines at ±COURT_HALF_LENGTH),
// its width along Z. The player attacks the +X hoop.

export const FT = 0.3048;
export const IN = 0.0254;

export const COURT_LENGTH = 94 * FT; // 28.65 m
export const COURT_WIDTH = 50 * FT; // 15.24 m
export const COURT_HALF_LENGTH = COURT_LENGTH / 2;
export const COURT_HALF_WIDTH = COURT_WIDTH / 2;

export const LINE_WIDTH = 2 * IN;

export const RIM_HEIGHT = 10 * FT; // 3.048 m
export const RIM_RADIUS = 9 * IN; // 18 in inner diameter
export const RIM_TUBE = 0.3125 * IN;
export const HOOP_FROM_BASELINE = 5.25 * FT; // rim centre
export const BACKBOARD_FROM_BASELINE = 4 * FT; // board face
export const BACKBOARD_WIDTH = 6 * FT;
export const BACKBOARD_HEIGHT = 3.5 * FT;
export const BACKBOARD_BOTTOM = RIM_HEIGHT - 0.5 * FT;
export const BOARD_THICKNESS = 0.05;
export const NET_LENGTH = 0.45;
export const NET_BOTTOM_RADIUS = 0.13;
export const BOX_WIDTH = 24 * IN;
export const BOX_HEIGHT = 18 * IN;

export const LANE_WIDTH = 16 * FT;
export const LANE_LENGTH = 19 * FT; // baseline → free-throw line
export const FREE_THROW_CIRCLE_RADIUS = 6 * FT;
export const THREE_POINT_RADIUS = 23.75 * FT;
export const THREE_POINT_CORNER = 22 * FT; // lateral distance from hoop centre
export const RESTRICTED_RADIUS = 4 * FT;
export const CENTER_CIRCLE_RADIUS = 6 * FT;
export const CENTER_INNER_RADIUS = 2 * FT;

export const BALL_CIRCUMFERENCE = 29.5 * IN; // 0.749 m
export const BALL_RADIUS = BALL_CIRCUMFERENCE / (2 * Math.PI); // 0.1192 m

// Gym shell (not regulation — art direction).
export const GYM_MIN_X = -COURT_HALF_LENGTH - 3;
export const GYM_MAX_X = COURT_HALF_LENGTH + 3;
export const GYM_MIN_Z = -COURT_HALF_WIDTH - 5.4; // bleachers side
export const GYM_MAX_Z = COURT_HALF_WIDTH + 3.6;
export const GYM_HEIGHT = 8;

// Hoop centres on the floor plane.
export const HOOP_X = COURT_HALF_LENGTH - HOOP_FROM_BASELINE;

// Player is drawn ~8% larger than life (NBA Jam style); ball and court stay real.
export const PLAYER_SCALE = 1.08;

// Ball physics (regulation size 7, inflated to spec, on hardwood).
export const GRAVITY = 9.81;
export const BALL_MASS = 0.62; // kg
export const BALL_RESTITUTION = 0.78; // floor bounce, hardwood
export const BALL_WALL_RESTITUTION = 0.6;
export const BALL_FLOOR_FRICTION = 0.35; // Coulomb μ at the contact patch
export const BALL_ROLLING_DECEL = 0.45; // m/s² rolling resistance once it stops bouncing
export const RIM_RESTITUTION = 0.55; // steel rim on a breakaway mount
export const RIM_FRICTION = 0.4;
export const BOARD_RESTITUTION = 0.62; // tempered glass
export const BOARD_FRICTION = 0.3;

// Where the player may walk (and where a loose ball is kept): the gym floor in
// front of the bleachers, short of the walls.
export const FLOOR_MIN_X = GYM_MIN_X + 0.6;
export const FLOOR_MAX_X = GYM_MAX_X - 0.6;
export const FLOOR_MIN_Z = -COURT_HALF_WIDTH - 1.1;
export const FLOOR_MAX_Z = GYM_MAX_Z - 0.6;
