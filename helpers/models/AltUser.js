const { DataTypes } = require("@sequelize/core");

const AltUserModel = (db) => db.define('User', {
    user_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, },
    is_bot: { type: DataTypes.BOOLEAN, allowNull: false, },
    is_supporter: { type: DataTypes.BOOLEAN, allowNull: false, },
    pm_friends_only: { type: DataTypes.BOOLEAN, allowNull: false, },
    username: { type: DataTypes.STRING, allowNull: false, },
    discord: { type: DataTypes.STRING, allowNull: true, },
    has_supported: { type: DataTypes.BOOLEAN, allowNull: false, },
    interests: { type: DataTypes.JSON, allowNull: true, },
    join_date: { type: DataTypes.DATE, allowNull: false, },
    total_kudosu: { type: DataTypes.INTEGER, allowNull: false, },
    available_kudosu: { type: DataTypes.INTEGER, allowNull: false, },
    location: { type: DataTypes.STRING, allowNull: true, },
    occupation: { type: DataTypes.STRING, allowNull: true, },
    post_count: { type: DataTypes.INTEGER, allowNull: false, },
    title: { type: DataTypes.STRING, allowNull: true, },
    twitter: { type: DataTypes.STRING, allowNull: true, },
    website: { type: DataTypes.STRING, allowNull: true, },
    country_code: { type: DataTypes.STRING, allowNull: true, },
    country_name: { type: DataTypes.STRING, allowNull: true, },
    active_tournament_banner: { type: DataTypes.STRING, allowNull: true, },
    beatmap_playcounts_count: { type: DataTypes.INTEGER, allowNull: false, },
    comments_count: { type: DataTypes.INTEGER, allowNull: false, },
    favourite_beatmapset_count: { type: DataTypes.INTEGER, allowNull: false, },
    follower_count: { type: DataTypes.INTEGER, allowNull: false, },
    graveyard_beatmapset_count: { type: DataTypes.INTEGER, allowNull: false, },
    mapping_follower_count: { type: DataTypes.INTEGER, allowNull: false, },
    pending_beatmapset_count: { type: DataTypes.INTEGER, allowNull: false, },
    ranked_beatmapset_count: { type: DataTypes.INTEGER, allowNull: false, },
    scores_first_count: { type: DataTypes.INTEGER, allowNull: false, },
    level: { type: DataTypes.FLOAT, allowNull: false, },
    global_rank: { type: DataTypes.INTEGER, allowNull: false, },
    pp: { type: DataTypes.FLOAT, allowNull: false, },
    ranked_score: { type: DataTypes.BIGINT, allowNull: false, },
    hit_accuracy: { type: DataTypes.FLOAT, allowNull: false, },
    playcount: { type: DataTypes.INTEGER, allowNull: false, },
    playtime: { type: DataTypes.INTEGER, allowNull: false, },
    total_score: { type: DataTypes.BIGINT, allowNull: false, },
    total_hits: { type: DataTypes.INTEGER, allowNull: false, },
    maximum_combo: { type: DataTypes.INTEGER, allowNull: false, },
    replays_watched: { type: DataTypes.INTEGER, allowNull: false, },
    is_ranked: { type: DataTypes.BOOLEAN, allowNull: false, },
    ss_count: { type: DataTypes.INTEGER, allowNull: false, },
    ssh_count: { type: DataTypes.INTEGER, allowNull: false, },
    s_count: { type: DataTypes.INTEGER, allowNull: false, },
    sh_count: { type: DataTypes.INTEGER, allowNull: false, },
    a_count: { type: DataTypes.INTEGER, allowNull: false, },
    country_rank: { type: DataTypes.INTEGER, allowNull: false, },
    support_level: { type: DataTypes.INTEGER, allowNull: false, },
}, {
    tableName: 'users2',
    timestamps: false,
});
module.exports.AltUserModel = AltUserModel;