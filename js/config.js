// =============================================================================
// config.js  —  ALL TUNABLE CONSTANTS LIVE HERE
// -----------------------------------------------------------------------------
// Edit numbers here to rebalance the sim. Nothing gameplay-related should be
// hard-coded elsewhere; import CONFIG and reference these values instead.
// =============================================================================

export const CONFIG = {
  // ---- League structure -----------------------------------------------------
  ROSTER_MIN: 12,            // minimum players a team must carry
  ROSTER_MAX: 15,            // maximum players a team may carry
  GAMES_PER_SEASON: 82,      // regular-season games per team
  MAX_GAMES_PER_DAY: 8,      // cap on league games in one day (stretches calendar)
  MINUTES_PER_GAME: 48,      // regulation minutes
  LINEUP_SLOTS: 5,           // players on court at once
  // Total assignable minutes across the rotation = MINUTES_PER_GAME * LINEUP_SLOTS
  get TOTAL_TEAM_MINUTES() { return this.MINUTES_PER_GAME * this.LINEUP_SLOTS; }, // 240
  ROTATION_SIZE: 8,          // players used for power-rating calc (8-man rotation)

  // ---- Salary cap (current NBA, in thousands to match BBGM contract.amount) --
  // BBGM contract.amount is stored in thousands (e.g. 36900 => $36.9M).
  SALARY_CAP: 140588,        // 2024-25 NBA cap ($140.588M)
  MIN_SALARY: 1200,          // rough veteran minimum ($1.2M)
  MAX_SALARY: 60000,         // supermax ceiling used for generated contracts
  LUXURY_TAX: 170814,        // luxury tax line (informational)
  CONTRACT_MIN_YEARS: 1,
  CONTRACT_MAX_YEARS: 5,

  // ---- Home-court advantage & simulation ------------------------------------
  HCA: 3,                    // home-court advantage in "power points"
  LOGISTIC_SCALE: 40,        // denominator in win-prob logistic (larger = flatter)
  SIM_VARIANCE: 1.0,         // global multiplier on random score noise
  BASE_PACE: 99,             // possessions/team/game baseline
  PACE_VARIANCE: 6,          // stddev of pace per game
  BASE_ORTG: 113,            // points per 100 possessions baseline
  ORTG_PER_POWER: 0.35,      // how much a point of power rating shifts ORtg
  SCORE_STDDEV: 9,           // stddev of final-score noise per team
  LEAGUE_AVG_POWER: 61,      // reference power rating (~ league-average rescaled ovr)
  SCORE_POINTS_PER_POWER: 0.6, // points added per power point above league avg
  REPLACEMENT_OVR: 46,       // ovr (rescaled scale) used to fill minutes lost to injury
  // Overall-rating rescale: the raw BBGM ovr formula clusters players in the
  // ~40s–70s. These piecewise-linear anchors stretch that onto a wider curve so
  // MVP/stars reach the mid-90s while role players stay in the 50s–60s. Input =
  // raw computeOvr, output = displayed ovr. Values outside the range extrapolate
  // linearly off the nearest segment (then clamp 0..99).
  OVR_RESCALE_ANCHORS: [
    { in: 39, out: 48 },
    { in: 50, out: 54 },
    { in: 55, out: 58 },
    { in: 60, out: 65 },
    { in: 65, out: 75 },
    { in: 70, out: 85 },
    { in: 76, out: 95 },
  ],
  // Team-total stat means used to sample & distribute a box score.
  TEAM_REB_MEAN: 44, TEAM_REB_STD: 5,
  TEAM_AST_MEAN: 25, TEAM_AST_STD: 4,
  TEAM_STL_MEAN: 7.5, TEAM_STL_STD: 2,
  TEAM_BLK_MEAN: 5, TEAM_BLK_STD: 2,
  TEAM_TOV_MEAN: 13, TEAM_TOV_STD: 3,

  // ---- Player value weights (used for trades, FA, AI decisions) -------------
  VALUE_WEIGHTS: {
    ovr: 1.0,                // weight on current ability
    pot: 0.45,              // weight on ceiling/potential
    contract: 0.35,         // weight on contract surplus (value vs market)
  },
  PEAK_AGE: 27,              // age of peak on the age curve
  AGE_CURVE_WIDTH: 7,        // how quickly value falls away from peak (larger=flatter)
  AGE_CURVE_MAX_PENALTY: 0.30, // max fractional value reduction from age

  // ---- Market / contract willingness ----------------------------------------
  // Market value ($k/yr) is derived from ovr via a curve anchored at these pts.
  MARKET_OVR_ANCHORS: [
    { ovr: 40, salary: 1200 },
    { ovr: 50, salary: 5000 },
    { ovr: 60, salary: 15000 },
    { ovr: 70, salary: 32000 },
    { ovr: 80, salary: 50000 },
    { ovr: 90, salary: 60000 },
  ],
  // A player accepts less to join a good team. Discount scales with how far the
  // signing team's win% is above .500, up to CONTRACT_MAX_GOOD_TEAM_DISCOUNT.
  CONTRACT_WILLINGNESS_DISCOUNT: 0.15, // base random willingness spread (+/-)
  CONTRACT_MAX_GOOD_TEAM_DISCOUNT: 0.20, // best team => asks up to 20% less
  EXTENSION_WINDOW_YEARS: 1, // players in final `n` years of deal are extension-eligible
  // User contract offers (signings + extensions): accept when the total offered
  // value (amount x years) is at least this fraction of the total demanded value.
  CONTRACT_ACCEPT_RATIO: 0.90,
  // Restricted free agents: to pry an RFA off another team, the offer's total
  // value must beat the demand by this premium (otherwise the team "matches").
  RFA_OFFER_PREMIUM: 1.10,

  // ---- Trade logic ----------------------------------------------------------
  TRADE_SALARY_MATCH_PCT: 1.25,     // outgoing salary must be within 125% ...
  TRADE_SALARY_MATCH_FLAT: 100,     // ... + $100k of incoming (in $k)
  TRADE_FAIRNESS_THRESHOLD: 0.90,   // AI accepts if value_in / value_out >= this
  TRADE_POSITIONAL_NEED_BONUS: 0.12, // value multiplier for filling a position need
  TRADE_POSITION_SURPLUS_COUNT: 3,   // >=N players at a pos => that pos is a "surplus"
  TRADE_POSITION_NEED_COUNT: 1,      // <=N quality players => that pos is a "need"

  // ---- Draft pick trade valuation (value points per pick slot) --------------
  PICK_VALUE_ROUND1_TOP: 900,   // value of a projected #1 pick
  PICK_VALUE_ROUND1_BOTTOM: 120, // value of a late-1st pick
  PICK_VALUE_ROUND2: 40,         // flat-ish value for 2nd-round picks
  PICK_VALUE_FUTURE_DISCOUNT: 0.85, // per-year discount for picks further out

  // ---- Draft lottery (real NBA odds for #1 pick, worst-to-best) -------------
  // 14 lottery teams. Values are % chance at the #1 overall pick.
  LOTTERY_ODDS: [14.0, 14.0, 14.0, 12.5, 10.5, 9.0, 7.5, 6.0, 4.5, 3.0, 2.0, 1.5, 1.0, 0.5],
  LOTTERY_TEAMS: 14,          // number of non-playoff teams in lottery
  DRAFT_ROUNDS: 2,
  DRAFT_AGE_MIN: 19,
  DRAFT_AGE_MAX: 22,

  // ---- Rookie generation (for seasons after the initial roster file) --------
  ROOKIE_OVR_RANGE: [28, 62],   // min/max starting ovr for generated rookies
  ROOKIE_POT_RANGE: [40, 80],   // min/max potential
  ROOKIE_TOP_PICK_OVR_BONUS: 14, // extra ovr scaled by draft position for early picks
  ROOKIE_TOP_PICK_POT_BONUS: 18, // extra pot scaled by draft position
  ROOKIE_HGT_RANGE: [72, 86],   // inches
  ROOKIE_WEIGHT_RANGE: [170, 260],

  // ---- Progression / aging (per-season rating change) -----------------------
  PROGRESSION_YOUNG_AGE: 24,    // at/below this age, high pot => growth
  PROGRESSION_OLD_AGE: 30,      // at/above this age, decline accelerates
  PROGRESSION_MAX_GROWTH: 6,    // max ovr gained in a season by a top prospect
  PROGRESSION_MAX_DECLINE: 5,   // max ovr lost in a season by an old player
  PROGRESSION_POT_SCALE: 0.12,  // growth = (pot-ovr) * scale, gated by age

  // ---- Injuries --------------------------------------------------------------
  INJURY_BASE_RATE: 0.02,       // per-player per-game chance of a new injury
  INJURY_PRONENESS_SPREAD: 1.6, // multiplier range for injury-prone players
  INJURY_MIN_GAMES: 1,          // min games missed
  INJURY_MAX_GAMES: 60,         // max games missed for a severe injury
  INJURY_SEVERITY_MEAN: 5,      // mean games missed (exponential-ish)

  // ---- Misc ------------------------------------------------------------------
  PLAYOFF_TEAMS_PER_CONF: 8,    // classic 8-per-conference bracket
  PLAYOFF_SERIES_LENGTH: 7,     // best-of-7
  DEFAULT_SEASON: 2025,
  STORAGE_KEY: 'nbaTextSim.save.v1',
};

export default CONFIG;
