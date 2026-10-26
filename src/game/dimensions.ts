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
