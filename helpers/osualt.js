const moment = require("moment/moment");
const { Op, Sequelize } = require("sequelize");
const { AltPriorityUser, AltUser, AltUniqueSS, AltUniqueFC, AltUniqueDTFC, AltUserAchievement, AltScore, AltBeatmap, AltModdedStars, Databases, InspectorUser } = require("./db");
const { CorrectedSqlScoreMods, CorrectedSqlScoreModsCustom } = require("./misc");
const { GetUsers } = require("./osu");
const { default: axios } = require("axios");
require('dotenv').config();

const beatmap_columns = `
beatmaps.approved, 
    beatmaps.submit_date, 
    beatmaps.approved_date, 
    beatmaps.last_update,
    beatmaps.artist,
    beatmaps.set_id,
    beatmaps.bpm,
    beatmaps.creator,
    beatmaps.creator_id,
    beatmaps.stars,
    beatmaps.diff_aim,
    beatmaps.diff_speed,
    beatmaps.cs,
    beatmaps.od,
    beatmaps.ar,
    beatmaps.hp,
    beatmaps.drain,
    beatmaps.source,
    beatmaps.genre,
    beatmaps.language,
    beatmaps.title,
    beatmaps.length,
    beatmaps.diffname,
    beatmaps.file_md5,
    beatmaps.mode,
    beatmaps.tags,
    beatmaps.favorites,
    beatmaps.rating,
    beatmaps.playcount,
    beatmaps.passcount,
    beatmaps.maxcombo,
    beatmaps.circles,
    beatmaps.sliders,
    beatmaps.spinners,
    beatmaps.storyboard,
    beatmaps.video,
    beatmaps.download_unavailable,
    beatmaps.audio_unavailable,
    beatmaps.beatmap_id
`;

const score_columns = `
    scores.user_id, 
    scores.beatmap_id, 
    scores.score, 
    scores.count300, 
    scores.count100, 
    scores.count50, 
    scores.countmiss, 
    scores.combo, 
    scores.perfect, 
    scores.enabled_mods, 
    scores.date_played, 
    scores.rank, 
    scores.pp, 
    scores.accuracy, 
    ${beatmap_columns},
    moddedsr.star_rating,
    moddedsr.aim_diff,
    moddedsr.speed_diff,
    moddedsr.fl_diff,
    moddedsr.slider_factor,
    moddedsr.speed_note_count,
    moddedsr.modded_od,
    moddedsr.modded_ar,
    moddedsr.modded_cs,
    moddedsr.modded_hp
`;

const score_columns_full = `
    scores.user_id, 
    scores.beatmap_id, 
    scores.score, 
    scores.count300, 
    scores.count100, 
    scores.count50, 
    scores.countmiss, 
    scores.combo, 
    scores.perfect, 
    scores.enabled_mods, 
    scores.date_played, 
    scores.rank, 
    scores.pp, 
    scores.accuracy, 
    ${beatmap_columns},
    moddedsr.star_rating,
    moddedsr.aim_diff,
    moddedsr.speed_diff,
    moddedsr.fl_diff,
    moddedsr.slider_factor,
    moddedsr.speed_note_count,
    moddedsr.modded_od,
    moddedsr.modded_ar,
    moddedsr.modded_cs,
    moddedsr.modded_hp,
    pack_id
    `;
module.exports.score_columns = score_columns;
module.exports.beatmap_columns = beatmap_columns;
module.exports.score_columns_full = score_columns_full;

module.exports.IsRegistered = IsRegistered;
async function IsRegistered(id) {
    let data;
    try {
        const exists = await AltPriorityUser.findByPk(id);
        data = { registered: exists ? true : false };
    } catch (err) {
        throw new Error('Something went wrong, please try later...');
    }
    return data;
}

module.exports.GetAllUsers = GetAllUsers;
async function GetAllUsers() {
    let data;
    try {
        const rows = await AltUser.findAll({
            attributes: ['user_id', 'username'],
            include: [{
                model: AltPriorityUser,
                as: 'priority',
                attributes: [],
                required: true
            }]
        });
        data = rows;
    } catch (err) {
        throw new Error(err.message);
    }
    return data;
}

module.exports.GetUser = GetUser;
async function GetUser(id) {
    let data;
    try {
        const user = await AltUser.findOne({
            where: { user_id: id },
            include: [
                { model: AltUniqueSS, as: 'unique_ss', attributes: ['beatmap_id'], required: false },
                { model: AltUniqueFC, as: 'unique_fc', attributes: ['beatmap_id'], required: false },
                { model: AltUniqueDTFC, as: 'unique_dt_fc', attributes: ['beatmap_id'], required: false },
                { model: AltUserAchievement, as: 'medals', attributes: ['achievement_id', 'achieved_at'], required: false }]
        });
        data = user;
    } catch (err) {
        throw new Error(err.message);
    }
    return data;
}

module.exports.FindUser = FindUser;
async function FindUser(query, single, requirePriority = true) {
    let data;
    try {
        let rows = await AltUser.findAll({
            attributes: single ? ['*'] : ['user_id', 'username', 'country_code', 'global_rank'],
            include: [{
                model: AltPriorityUser,
                as: 'priority',
                attributes: [],
                required: requirePriority
            }],
            //order by rank but remove sign
            order: [
                [Sequelize.fn('SIGN', Sequelize.col('global_rank')), 'DESC'],
                [Sequelize.fn('ABS', Sequelize.col('global_rank')), 'ASC']
            ],
            where: single ? { user_id: query } : { username: { [Op.iLike]: `%${query}%` } },
        });

        if(rows.length > 0) {
            //find or create proxy inspector user
            rows = JSON.parse(JSON.stringify(rows));

            const user_ids = rows.map(x => x.user_id);
            const inspector_users = await InspectorUser.findAll({
                where: { osu_id: { [Op.in]: user_ids } }
            });

            let osu_users = [];
            let rank_users = [];

            //split ids into chunks of 50
            const chunk_size = 50;
            const chunks = [];
            for (let i = 0; i < user_ids.length; i += chunk_size) {
                chunks.push(user_ids.slice(i, i + chunk_size));
            }
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const osu_users_chunk = await GetUsers(chunk);
                osu_users = osu_users.concat(osu_users_chunk.users);

                let scoreRes = await axios.get(`https://score.respektive.pw/u/${chunk.join(',')}`);
                rank_users = rank_users.concat(JSON.parse(JSON.stringify(scoreRes?.data)));
            }

            for (let i = 0; i < rows.length; i++) {
                const inspector_user = inspector_users?.find(x => x.osu_id == rows[i].user_id);
                const osu_user = osu_users?.find(x => x.id == rows[i].user_id);
                const rank_user = rank_users?.find(x => x.user_id == rows[i].user_id);

                if (rank_user) {
                    rows[i].score_rank = rank_user;
                }

                if (osu_user) {
                    rows[i].osu = osu_user;
                }

                if (inspector_user) {
                    rows[i].inspector_user = inspector_user;
                }else{
                    rows[i].inspector_user = {
                        id: null,
                        osu_id: rows[i].user_id,
                        known_username: rows[i].username,
                        roles: []
                    }
                }
            }

            //remove rows that dont have an osu user
            rows = rows.filter(x => x.osu);
        }

        if (single) {
            if (rows.length == 0)
                throw new Error('No user found');
            else
                data = rows[0];
        } else {
            data = rows;
        }
    } catch (err) {
        console.error(err);
        throw new Error(err.message);
    }
    return data;
}

module.exports.GetBestScores = GetBestScores;
async function GetBestScores(period, stat, limit, loved = false) {
    let data;
    try {
        let period_check = null;
        switch (period) {
            case 'day':
                period_check = 1;
                break;
            case 'week':
                period_check = 7;
                break;
            case 'month':
                period_check = 31;
                break;
            case 'year':
                period_check = 365;
                break;
            case 'all':
                period_check = null;
                break;
        }
        //create a subquery which orders and limits the scores, then afterwards join the users and beatmaps
        const query = `
            SELECT * FROM scores
            WHERE ${stat} > 0 
            AND NULLIF(${stat}, 'NaN'::NUMERIC) IS NOT NULL 
            ${period_check !== null ? `AND date_played > NOW() - INTERVAL '${period_check} days'` : ''}
            ORDER BY ${stat} DESC
            LIMIT ${limit}`;

        const rows = await Databases.osuAlt.query(query);

        data = rows[0];

        const { users } = await GetUsers(data.map(x => x.user_id));
        for await(let score of data) {
            // add the beatmap data
            const beatmap_rows = await Databases.osuAlt.query(`
                SELECT * FROM beatmaps 
                WHERE beatmap_id = ${score.beatmap_id}`);
            score.beatmap = beatmap_rows[0]?.[0];

            if(score.beatmap){
                // add the modded stars data
                const modded_sr_rows = await Databases.osuAlt.query(`
                    SELECT * FROM moddedsr 
                    WHERE beatmap_id = ${score.beatmap_id} 
                    AND mods_enum = ${CorrectedSqlScoreModsCustom(score.enabled_mods)}`);
                score.beatmap.modded_sr = modded_sr_rows[0]?.[0];
            }

            // add the user data
            if (users) {
                users.forEach(osu_user => {
                    if (osu_user.id == score.user_id){
                        score.user = osu_user;
                    }
                });
            }
        }
    } catch (err) {
        console.error(err);
        throw new Error(err.message);
    }
    return data;
}

module.exports.GetBeatmapScores = GetBeatmapScores;
async function GetBeatmapScores(beatmap_id, limit = 0, offset = 0){
    let data;
    try{
        const rows = await Databases.osuAlt.query(`
            SELECT * FROM scores
            WHERE beatmap_id = ${beatmap_id} AND user_id in (select user_id from users2)
            ORDER BY score DESC
            ${limit!==undefined && limit > 0 ? `LIMIT ${limit}` : ''}
            ${offset!==undefined && offset > 0 ? `OFFSET ${offset}` : ''}
            `);
        let scores = rows?.[0];

        const user_ids = scores.map(x => x.user_id);
        let users = await AltUser.findAll({
            attributes: ['user_id', 'username', 'country_code'],
            where: { user_id: user_ids }
        });

        const inspector_users = await InspectorUser.findAll({
            where: { osu_id: user_ids }
        });

        for await(let score of scores){
            score.user = {};
            let user = users.find(x => x.user_id == score.user_id);
            let inspector_user = inspector_users.find(x => x.osu_id == score.user_id);
            if (user) {
                score.user = JSON.parse(JSON.stringify(user));
            } else {
                score.user = {
                    id: null,
                    osu_id: score.user_id,
                    country_code: null
                }
            }

            score.user.inspector_user = {};

            if (inspector_user) {
                score.user.inspector_user = inspector_user;
            } else {
                //generate a new inspector user
                score.user.inspector_user = {
                    id: null,
                    osu_id: score.user_id,
                    known_username: score.user.username,
                    roles: []
                }
            }
        };

        data = scores;
        //data = rows;
    }catch(err){
        throw new Error(err.message);
    }
    return data;
}

module.exports.GetSystemInfo = GetSystemInfo;
async function GetSystemInfo() {
    let data;
    try {
        const total_scores = await AltScore.count();
        const total_users = await AltUser.count();
        const tracked_users = await AltPriorityUser.count();
        const [size, _] = await Databases.osuAlt.query(`SELECT pg_database_size('osu') as c`);
        data = { total_scores, total_users, tracked_users, size: size[0].c };
    } catch (err) {
        throw new Error(err.message);
    }
    return data;
}