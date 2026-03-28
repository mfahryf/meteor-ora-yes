// src/tools/definitions.ts
// All tool schemas in OpenAI function calling format, categorized by role.

export type ToolCategory =
    | "screening"
    | "position"
    | "wallet"
    | "token"
    | "smart_wallet"
    | "memory"
    | "strategy"
    | "blacklist"
    | "self_mgmt"
    | "lper";

export interface ToolDef {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, any>;
            required: string[];
        };
    };
    _meta?: { category: ToolCategory; write: boolean; roles: string[] };
}

function tool(
    name: string,
    description: string,
    properties: Record<string, any>,
    required: string[],
    meta: { category: ToolCategory; write: boolean; roles: string[] }
): ToolDef {
    return {
        type: "function",
        function: { name, description, parameters: { type: "object", properties, required } },
        _meta: meta,
    };
}

// --- Screening ---
const discoverPools = tool("discover_pools",
    "Discover DLMM pools from Meteora API with filters for TVL, volume, bin step.",
    {
        min_tvl: { type: "number", description: "Minimum TVL in USD" },
        max_tvl: { type: "number", description: "Maximum TVL in USD" },
        min_volume: { type: "number", description: "Minimum 24h volume in USD" },
        min_bin_step: { type: "number", description: "Minimum bin step" },
        max_bin_step: { type: "number", description: "Maximum bin step" },
        limit: { type: "number", description: "Max pools to return (default 20)" },
    },
    [],
    { category: "screening", write: false, roles: ["SCREENER", "CHAT"] }
);

const getTopCandidates = tool("get_top_candidates",
    "Get pre-scored and pre-filtered top N pool candidates based on the active strategy profile.",
    { limit: { type: "number", description: "Number of candidates (default 10)" } },
    [],
    { category: "screening", write: false, roles: ["SCREENER", "CHAT"] }
);

const getPoolDetail = tool("get_pool_detail",
    "Get detailed information about a single DLMM pool including current bin, TVL, volume, fees.",
    { pool_address: { type: "string", description: "Pool address" } },
    ["pool_address"],
    { category: "screening", write: false, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

const searchPools = tool("search_pools",
    "Search pools by token symbol or contract address.",
    { query: { type: "string", description: "Token symbol or CA to search" }, limit: { type: "number", description: "Max results (default 10)" } },
    ["query"],
    { category: "screening", write: false, roles: ["SCREENER", "CHAT"] }
);

const getPoolOhlcv = tool("get_pool_ohlcv",
    "Get OHLCV candle data for a pool. Useful for price trend analysis.",
    {
        pool_address: { type: "string", description: "Pool address" },
        timeframe: { type: "string", description: "Candle interval: 5m, 30m, 1h, 2h, 4h, 12h, 24h (default 24h)" },
        start_time: { type: "number", description: "Start time as unix timestamp (seconds)" },
        end_time: { type: "number", description: "End time as unix timestamp (seconds)" },
    },
    ["pool_address"],
    { category: "screening", write: false, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

const getPoolVolumeHistory = tool("get_pool_volume_history",
    "Get historical volume data for a pool aggregated into time buckets.",
    {
        pool_address: { type: "string", description: "Pool address" },
        timeframe: { type: "string", description: "Time bucket: 5m, 30m, 1h, 2h, 4h, 12h, 24h (default 24h)" },
        start_time: { type: "number", description: "Start time as unix timestamp (seconds)" },
        end_time: { type: "number", description: "End time as unix timestamp (seconds)" },
    },
    ["pool_address"],
    { category: "screening", write: false, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

// --- Position Management ---
const deployPosition = tool("deploy_position",
    "Open a new LP position in a DLMM pool. WRITE operation - requires safety checks.",
    {
        pool_address: { type: "string", description: "Pool address" },
        bin_step: { type: "number", description: "Bin step for the position" },
        min_bin: { type: "number", description: "Lower bin boundary" },
        max_bin: { type: "number", description: "Upper bin boundary" },
        amount_sol: { type: "number", description: "Amount of SOL to deploy" },
        strategy_type: { type: "string", description: "Strategy: spot, curve, bid_ask" },
        allow_duplicate_pool: { type: "boolean", description: "Allow if already have position in this pool" },
    },
    ["pool_address", "bin_step", "min_bin", "max_bin", "amount_sol", "strategy_type"],
    { category: "position", write: true, roles: ["SCREENER", "CHAT"] }
);

const closePosition = tool("close_position",
    "Close an existing LP position by withdrawing all liquidity. WRITE operation.",
    { position_pubkey: { type: "string", description: "Position public key" }, pool_address: { type: "string", description: "Pool address" } },
    ["position_pubkey", "pool_address"],
    { category: "position", write: true, roles: ["MANAGER", "CHAT"] }
);

const claimFees = tool("claim_fees",
    "Claim accumulated fees from an LP position. WRITE operation.",
    { position_pubkey: { type: "string", description: "Position public key" }, pool_address: { type: "string", description: "Pool address" } },
    ["position_pubkey", "pool_address"],
    { category: "position", write: true, roles: ["MANAGER", "CHAT"] }
);

const withdrawLiquidity = tool("withdraw_liquidity",
    "Withdraw partial or full liquidity from a position. WRITE operation.",
    { position_pubkey: { type: "string", description: "Position public key" }, pool_address: { type: "string", description: "Pool address" }, percentage: { type: "number", description: "Percentage to withdraw (1-100)" } },
    ["position_pubkey", "pool_address", "percentage"],
    { category: "position", write: true, roles: ["MANAGER", "CHAT"] }
);

const addLiquidity = tool("add_liquidity",
    "Add more liquidity to an existing position. WRITE operation.",
    { position_pubkey: { type: "string", description: "Position public key" }, pool_address: { type: "string", description: "Pool address" }, amount_sol: { type: "number", description: "Amount of SOL to add" } },
    ["position_pubkey", "pool_address", "amount_sol"],
    { category: "position", write: true, roles: ["MANAGER", "CHAT"] }
);

const getPositionPnl = tool("get_position_pnl",
    "Get PnL and real-time metrics for a specific position.",
    { position_pubkey: { type: "string", description: "Position public key" } },
    ["position_pubkey"],
    { category: "position", write: false, roles: ["MANAGER", "CHAT"] }
);

const getMyPositions = tool("get_my_positions",
    "Get all open positions with current state.",
    {},
    [],
    { category: "position", write: false, roles: ["MANAGER", "SCREENER", "CHAT"] }
);

// --- Wallet ---
const getWalletBalance = tool("get_wallet_balance",
    "Get current SOL and token balances for the agent wallet.",
    {},
    [],
    { category: "wallet", write: false, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

const swapToken = tool("swap_token",
    "Swap SOL for a target token or vice versa via Jupiter. WRITE operation.",
    { input_mint: { type: "string", description: "Input token mint address" }, output_mint: { type: "string", description: "Output token mint address" }, amount: { type: "number", description: "Amount in lamports/smallest unit" }, slippage_bps: { type: "number", description: "Slippage tolerance in basis points (default 50)" } },
    ["input_mint", "output_mint", "amount"],
    { category: "wallet", write: true, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

// --- Token Research ---
const getTokenInfo = tool("get_token_info",
    "Get token info: organic score, holder count, market cap, supply.",
    { mint: { type: "string", description: "Token mint address" } },
    ["mint"],
    { category: "token", write: false, roles: ["SCREENER", "CHAT"] }
);

const getTokenHolders = tool("get_token_holders",
    "Get top 100 holder distribution and global_fees_sol for a token.",
    { mint: { type: "string", description: "Token mint address" } },
    ["mint"],
    { category: "token", write: false, roles: ["SCREENER", "CHAT"] }
);

const getTokenNarrative = tool("get_token_narrative",
    "Get token narrative: origin, catalyst, community info.",
    { mint: { type: "string", description: "Token mint address" } },
    ["mint"],
    { category: "token", write: false, roles: ["SCREENER", "CHAT"] }
);

// --- Smart Wallets ---
const checkSmartWallets = tool("check_smart_wallets_on_pool",
    "Check if any tracked smart wallets are active in a pool.",
    { pool_address: { type: "string", description: "Pool address" } },
    ["pool_address"],
    { category: "smart_wallet", write: false, roles: ["SCREENER", "CHAT"] }
);

const addSmartWallet = tool("add_smart_wallet",
    "Add a wallet address to the smart wallet tracking list.",
    { address: { type: "string", description: "Wallet address" }, label: { type: "string", description: "Label for this wallet" } },
    ["address"],
    { category: "smart_wallet", write: true, roles: ["SCREENER", "CHAT"] }
);

const removeSmartWallet = tool("remove_smart_wallet",
    "Remove a wallet from the smart wallet tracking list.",
    { address: { type: "string", description: "Wallet address" } },
    ["address"],
    { category: "smart_wallet", write: true, roles: ["CHAT"] }
);

const listSmartWallets = tool("list_smart_wallets",
    "List all tracked smart wallets.",
    {},
    [],
    { category: "smart_wallet", write: false, roles: ["SCREENER", "CHAT"] }
);

// --- Memory & Learning ---
const addLesson = tool("add_lesson",
    "Save a lesson learned for future reference by a specific role.",
    { text: { type: "string", description: "The lesson text" }, role: { type: "string", description: "Role: SCREENER, MANAGER, EVOLVER, CHAT" }, tags: { type: "array", items: { type: "string" }, description: "Tags for categorization" } },
    ["text", "role"],
    { category: "memory", write: true, roles: ["EVOLVER", "CHAT"] }
);

const listLessonsTool = tool("list_lessons",
    "List recent lessons, optionally filtered by role.",
    { role: { type: "string", description: "Filter by role" }, pinned_only: { type: "boolean", description: "Only pinned lessons" }, limit: { type: "number", description: "Max lessons to return" } },
    [],
    { category: "memory", write: false, roles: ["SCREENER", "MANAGER", "EVOLVER", "CHAT"] }
);

const pinLesson = tool("pin_lesson",
    "Pin a lesson so it always appears in context.",
    { lesson_id: { type: "string", description: "Lesson ID to pin" } },
    ["lesson_id"],
    { category: "memory", write: true, roles: ["EVOLVER", "CHAT"] }
);

const unpinLesson = tool("unpin_lesson",
    "Unpin a lesson.",
    { lesson_id: { type: "string", description: "Lesson ID to unpin" } },
    ["lesson_id"],
    { category: "memory", write: true, roles: ["EVOLVER", "CHAT"] }
);

const addPoolNote = tool("add_pool_note",
    "Add a note/annotation to a pool for future reference.",
    { pool_address: { type: "string", description: "Pool address" }, note: { type: "string", description: "Note text" } },
    ["pool_address", "note"],
    { category: "memory", write: true, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

const getPoolMemory = tool("get_pool_memory",
    "Retrieve past notes and experiences with a specific pool.",
    { pool_address: { type: "string", description: "Pool address" } },
    ["pool_address"],
    { category: "memory", write: false, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

const getPerformanceHistory = tool("get_performance_history",
    "Get historical performance data: trades, PnL, win rate.",
    { days: { type: "number", description: "Lookback period in days (default 7)" } },
    [],
    { category: "memory", write: false, roles: ["EVOLVER", "CHAT"] }
);

// --- Strategy Library ---
const addStrategy = tool("add_strategy",
    "Add a new strategy profile to the library.",
    { name: { type: "string", description: "Strategy name" }, config: { type: "object", description: "Strategy configuration parameters" } },
    ["name", "config"],
    { category: "strategy", write: true, roles: ["EVOLVER", "CHAT"] }
);

const listStrategies = tool("list_strategies",
    "List all available strategy profiles.",
    {},
    [],
    { category: "strategy", write: false, roles: ["SCREENER", "MANAGER", "EVOLVER", "CHAT"] }
);

const getStrategy = tool("get_strategy",
    "Get details of a specific strategy profile.",
    { name: { type: "string", description: "Strategy name" } },
    ["name"],
    { category: "strategy", write: false, roles: ["SCREENER", "CHAT"] }
);

const setActiveStrategy = tool("set_active_strategy",
    "Set the active strategy profile for screening and management.",
    { name: { type: "string", description: "Strategy name to activate" } },
    ["name"],
    { category: "strategy", write: true, roles: ["SCREENER", "EVOLVER", "CHAT"] }
);

const removeStrategy = tool("remove_strategy",
    "Remove a strategy profile from the library.",
    { name: { type: "string", description: "Strategy name" } },
    ["name"],
    { category: "strategy", write: true, roles: ["EVOLVER", "CHAT"] }
);

// --- Blacklist ---
const addToBlacklist = tool("add_to_blacklist",
    "Add a token to the blacklist to skip during screening.",
    { token: { type: "string", description: "Token mint address or symbol" }, reason: { type: "string", description: "Reason for blacklisting" } },
    ["token"],
    { category: "blacklist", write: true, roles: ["SCREENER", "CHAT"] }
);

const removeFromBlacklist = tool("remove_from_blacklist",
    "Remove a token from the blacklist.",
    { token: { type: "string", description: "Token mint address or symbol" } },
    ["token"],
    { category: "blacklist", write: true, roles: ["CHAT"] }
);

const listBlacklist = tool("list_blacklist",
    "List all blacklisted tokens.",
    {},
    [],
    { category: "blacklist", write: false, roles: ["SCREENER", "CHAT"] }
);

// --- Self-Management ---
const updateConfig = tool("update_config",
    "Update a runtime configuration value.",
    { key: { type: "string", description: "Config key path (dot notation)" }, value: { type: "string", description: "New value as string" }, reason: { type: "string", description: "Reason for the change" } },
    ["key", "value", "reason"],
    { category: "self_mgmt", write: true, roles: ["SCREENER", "MANAGER", "EVOLVER", "CHAT"] }
);

// --- Top LPers ---
const getTopLpers = tool("get_top_lpers",
    "Get top liquidity providers for a pool.",
    { pool_address: { type: "string", description: "Pool address" }, limit: { type: "number", description: "Number of LPers (default 10)" } },
    ["pool_address"],
    { category: "lper", write: false, roles: ["SCREENER", "CHAT"] }
);

const studyTopLpers = tool("study_top_lpers",
    "Deep analysis of top LPers in a pool to extract strategy patterns and lessons.",
    { pool_address: { type: "string", description: "Pool address" } },
    ["pool_address"],
    { category: "lper", write: false, roles: ["SCREENER", "CHAT"] }
);

// --- Strategy Compute ---
const computeStrategyTool = tool("compute_strategy",
    "Compute deploy parameters for a given strategy type based on pool data and market signals. Returns bins, ratio, swap amount, and management rules.",
    {
        strategy_type: { type: "string", description: "Strategy: custom_ratio_spot, single_sided_reseed, fee_compounding, multi_layer, partial_harvest" },
        pool_address: { type: "string", description: "Pool address" },
        volatility: { type: "number", description: "Pool volatility" },
        price_trend: { type: "string", description: "Price trend: up, down, flat" },
        price_change_1h_pct: { type: "number", description: "1h price change percentage" },
        net_buyers_1h: { type: "number", description: "1h net buyers" },
        wallet_sol_balance: { type: "number", description: "Current SOL balance" },
        max_deploy_sol: { type: "number", description: "Max deploy amount in SOL (from config)" },
        gas_reserve: { type: "number", description: "Gas reserve in SOL (from config)" },
    },
    ["strategy_type", "pool_address", "volatility", "price_trend", "price_change_1h_pct", "net_buyers_1h", "wallet_sol_balance"],
    { category: "strategy", write: false, roles: ["SCREENER", "CHAT"] }
);

// --- Position Notes ---
const setPositionNote = tool("set_position_note",
    "Set a persistent instruction or note on a pool/position for future management decisions.",
    { pool_address: { type: "string", description: "Pool address" }, note: { type: "string", description: "Note or instruction text" }, agent_type: { type: "string", description: "Agent type that wrote this note" } },
    ["pool_address", "note"],
    { category: "memory", write: true, roles: ["SCREENER", "MANAGER", "CHAT"] }
);

export const ALL_TOOLS: ToolDef[] = [
    // Screening
    discoverPools, getTopCandidates, getPoolDetail, searchPools, getPoolOhlcv, getPoolVolumeHistory,
    // Position
    deployPosition, closePosition, claimFees, withdrawLiquidity, addLiquidity, getPositionPnl, getMyPositions,
    // Wallet
    getWalletBalance, swapToken,
    // Token
    getTokenInfo, getTokenHolders, getTokenNarrative,
    // Smart Wallets
    checkSmartWallets, addSmartWallet, removeSmartWallet, listSmartWallets,
    // Memory
    addLesson, listLessonsTool, pinLesson, unpinLesson, addPoolNote, getPoolMemory, getPerformanceHistory, setPositionNote,
    // Strategy
    addStrategy, listStrategies, getStrategy, setActiveStrategy, removeStrategy, computeStrategyTool,
    // Blacklist
    addToBlacklist, removeFromBlacklist, listBlacklist,
    // Self-management
    updateConfig,
    // LPers
    getTopLpers, studyTopLpers,
];

export function getToolsForRole(role: string): ToolDef[] {
    return ALL_TOOLS.filter(t => t._meta?.roles?.includes(role));
}

export function getWriteTools(): ToolDef[] {
    return ALL_TOOLS.filter(t => t._meta?.write === true);
}

export function getToolByName(name: string): ToolDef | undefined {
    return ALL_TOOLS.find(t => t.function.name === name);
}
