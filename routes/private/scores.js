var express = require('express');
var apicache = require('apicache');
var router = express.Router();
const { Client } = require('pg');
const { GetBestScores, score_columns, score_columns_full, beatmap_columns, GetBeatmapScores } = require('../../helpers/osualt');
const { getBeatmaps, getCompletionData, DefaultInspectorUser } = require('../../helpers/inspector');
const { AltScore, AltBeatmap, AltModdedStars, AltBeatmapPack, InspectorModdedStars, InspectorScoreStat, AltBeatmapEyup, Databases, AltBeatmapSSRatio, AltTopScore, InspectorHistoricalScoreRank, InspectorUser, InspectorRole, InspectorUserMilestone, InspectorOsuUser, InspectorPerformanceRecord, InspectorBeatmap, AltBeatmapMaxScoreNomod } = require('../../helpers/db');
const { Op, Sequelize } = require('sequelize');
const { CorrectedSqlScoreMods, CorrectMod, ModsToString, db_now } = require('../../helpers/misc');
const request = require("supertest");
const { GetOsuUsers } = require('../../helpers/osu');
const fastJson = require('fast-json-parse');
var _ = require('lodash');
const { parse } = require('dotenv');
require('dotenv').config();

let cache = apicache.middleware;

async function GetUserScores(req, score_attributes = undefined, beatmap_attributes = undefined) {
    const include_modded = req.query.ignore_modded_stars !== 'true';
    console.log(req.query.beatmap_id);
    let scores = await AltScore.findAll({
        where: {
            user_id: req.params.id
        },
        order: [
            ...req.query.order ? [['pp', req.query.dir ?? 'DESC']] : []
        ],
        limit: req.query.limit ?? undefined,
        include: [
            {
                model: AltBeatmap,
                as: 'beatmap',
                where: {
                    approved: { [Op.in]: [1, 2, req.query.include_loved === 'true' ? 4 : 1] },
                    ...(req.query.beatmap_id ? { beatmap_id: req.query.beatmap_id } : {}) //for development purposes
                },
                required: true,
                include: [
                    ...(include_modded ? [
                        {
                            model: AltModdedStars,
                            as: 'modded_sr',
                            where: {
                                mods_enum: {
                                    [Op.eq]: Sequelize.literal(CorrectedSqlScoreMods)
                                },
                                beatmap_id: {
                                    [Op.eq]: Sequelize.literal('beatmap.beatmap_id')
                                }
                            }
                        }] : [])
                ],
            },
            {
                model: AltTopScore,
                as: 'top_score',
                where: {
                    user_id: req.params.id
                },
                required: false,
            }
        ],
        nest: true
    });

    scores = JSON.parse(JSON.stringify(scores));

    //filter to have only approved in (1,2 and possibly 4)
    scores = scores.filter(score => score.beatmap.approved === 1 || score.beatmap.approved === 2 || (req.query.include_loved === 'true' && score.beatmap.approved === 4));

    let beatmap_set_ids = scores.map(score => score.beatmap.set_id);
    let beatmap_ids = scores.map(score => score.beatmap.beatmap_id);
    //remove duplicates and nulls
    beatmap_set_ids = [...new Set(beatmap_set_ids)].filter(id => id);
    beatmap_ids = [...new Set(beatmap_ids)].filter(id => id);

    const beatmap_packs = await AltBeatmapPack.findAll({
        where: {
            beatmap_id: {
                [Op.in]: beatmap_ids
            }
        },
        raw: true,
        nest: true
    });

    let _beatmap_packs = {};
    beatmap_packs.forEach(pack => {
        if (!_beatmap_packs[pack.beatmap_id]) {
            _beatmap_packs[pack.beatmap_id] = [];
        }

        _beatmap_packs[pack.beatmap_id].push(pack);
    });

    for (const score of scores) {
        score.beatmap.packs = _beatmap_packs[score.beatmap_id] ?? [];
    }

    return scores;
}

/* Get the entire list of scores of a user */
router.get('/user/:id', cache('1 minute'), async function (req, res, next) {
    try {
        const rows = await GetUserScores(req);
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

/* Get the entire list of scores of a beatmap */
router.get('/beatmap/:id', cache('1 hour'), async function (req, res, next) {
    try {
        const beatmap_id = req.params.id;
        const limit = req.query.limit ?? undefined;
        const offset = req.query.offset ?? undefined;
        const rows = await GetBeatmapScores(beatmap_id, limit, offset);
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

router.get('/completion/:id', cache('1 hour'), async function (req, res, next) {
    try {
        req.query.ignore_modded_stars = 'true';
        console.time('GetUserScores');
        const scores = await GetUserScores(req, ['beatmap_id'], ['beatmap_id', 'approved_date', 'length', 'stars', 'cs', 'ar', 'od', 'hp', 'approved', 'max_combo']);
        console.timeEnd('GetUserScores');

        const beatmaps = await getBeatmaps({
            ...req.query, customAttributeSet: [
                'beatmap_id',
                'cs',
                'ar',
                'od',
                'hp',
                'approved_date',
                'star_rating',
                'total_length',
                'max_combo',
            ]
        });

        console.time('getCompletionData');
        const data = getCompletionData(scores, beatmaps);
        console.timeEnd('getCompletionData');

        res.json(data);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

const valid_periods = ['all', 'year', 'month', 'week', 'day'];
const valid_stats = ['pp', 'score'];
router.get('/best', cache('1 hour'), async function (req, res, next) {
    const period = req.query.period || 'all';
    const stat = req.query.stat || 'pp';
    const limit = req.query.limit || 5;
    const loved = req.query.loved ? true : false;
    if (!valid_periods.includes(period)) {
        res.status(400).json({ "error": "Invalid period" });
        return;
    }
    if (!valid_stats.includes(stat)) {
        res.status(400).json({ "error": "Invalid stat" });
        return;
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ "error": "Invalid limit" });
        return;
    }

    let scores;
    try {
        scores = await GetBestScores(period, stat, limit, loved);
    } catch (e) {
        res.status(500).json({ "error": "Error while fetching scores" });
        return;
    }

    res.json(scores);
});

const STAT_PERIODS = [
    '30min', '24h', '7d', 'all'
]

router.get('/stats', async function (req, res, next) {
    //stats from today
    let data = {};
    try {
        for await (const period of STAT_PERIODS) {
            const rows = await InspectorScoreStat.findAll({
                where: {
                    period: period
                },
                raw: true,
                nest: true
            });

            data[period] = {};
            rows.forEach(row => {
                try {
                    data[period][row.key] = JSON.parse(row.value);
                } catch (e) {
                    data[period][row.key] = row.value;
                }
            });
        }

        const pp_distribution = JSON.parse((await InspectorScoreStat.findOne({
            where: {
                key: 'pp_distribution',
                period: 'misc'
            },
            raw: true,
            nest: true
        }))?.value);

        if (pp_distribution) {
            const user_ids = pp_distribution.map(row => row.most_common_user_id);
            //new set of unique user ids excluding nulls
            // let unique_user_ids = [...new Set(user_ids)];
            const unique_user_ids = user_ids.filter(id => id);

            const client = request(req.app);
            const users = await client.get(`/users/full/${unique_user_ids.join(',')}?force_array=false&skipDailyData=true`).set('Origin', req.headers.origin || req.headers.host);

            pp_distribution.forEach(row => {
                const user = users.body.find(user => user.osu.id === row.most_common_user_id);
                row.most_common_user = user;
            });
        }

        data.pp_distribution = pp_distribution ?? [];

        const pp_records = await InspectorPerformanceRecord.findAll({
            order: [
                ['pp', 'DESC']
            ],
            raw: true,
            nest: true
        });

        if (pp_records) {
            //unique user ids
            const user_ids = pp_records.map(record => record.user_id);
            const beatmap_ids = pp_records.map(record => record.beatmap_id);

            const client = request(req.app);
            const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true`).set('Origin', req.headers.origin || req.headers.host);

            //find scores for each pp_record
            const beatmap_user_pairs = pp_records.map(record => {
                return {
                    beatmap_id: record.beatmap_id,
                    user_id: record.user_id
                }
            });

            const scores = await AltScore.findAll({
                where: {
                    [Op.or]: beatmap_user_pairs
                },
                raw: true,
                nest: true,
                include: [
                    {
                        model: AltBeatmap,
                        as: 'beatmap',
                        required: true,
                        include: [
                            {
                                model: AltModdedStars,
                                as: 'modded_sr',
                                where: {
                                    mods_enum: {
                                        [Op.eq]: Sequelize.literal(CorrectedSqlScoreMods)
                                    },
                                    beatmap_id: {
                                        [Op.eq]: Sequelize.literal('beatmap.beatmap_id')
                                    }
                                }
                            }
                        ]
                    }
                ]
            });

            pp_records.forEach(record => {
                record.score = scores.find(score => score.beatmap_id === record.beatmap_id && score.user_id === record.user_id);
                record.user = users.body.find(user => user.osu.id === record.user_id);
            });

            //remove entries if the score is not found
            let pp_records_filtered = pp_records.filter(record => record.score);

            pp_records_filtered.sort((a, b) => b.pp - a.pp).reverse();

            data.pp_records = pp_records_filtered ?? [];
        }
    } catch (e) {
        console.error(e);
    }

    res.json(data);
});

router.get('/most_played', cache('1 hour'), async function (req, res, next) {
    try {
        const client = new Client({ user: process.env.ALT_DB_USER, host: process.env.ALT_DB_HOST, database: process.env.ALT_DB_DATABASE, password: process.env.ALT_DB_PASSWORD, port: process.env.ALT_DB_PORT });
        await client.connect();

        const limit = req.params.limit || 10;
        const offset = req.params.offset || 0;

        const query = `
        SELECT t.* FROM 
        (
            SELECT count(*), beatmaps.* 
            FROM scores LEFT JOIN beatmaps ON scores.beatmap_id = beatmaps.beatmap_id 
            WHERE (beatmaps.approved = 1 OR beatmaps.approved = 2 OR beatmaps.approved = 4) 
            GROUP BY beatmaps.beatmap_id 
            ORDER BY count(*) DESC
        ) as t 
        LIMIT ${limit} 
        OFFSET ${offset}`;

        const { rows } = await client.query(query);
        await client.end();
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

router.get('/activity', cache('20 minutes'), async function (req, res, next) {
    try {
        const interval = req.query.period_amount || 24;
        const period = req.query.period || 'h';
        let period_long = 'hour';
        switch (period) {
            case 'h':
                period_long = 'hour';
                break;
            case 'd':
                period_long = 'day';
                break;
            case 'm':
                period_long = 'month';
                break;
            case 'y':
                period_long = 'year';
                break;
        }
        const all_time = interval == -1;
        let oldest_possible_date = undefined;
        if (all_time) {
            //get oldest possible date from scores
            const oldest_score = await AltScore.findOne({
                order: [
                    ['date_played', 'ASC']
                ],
                raw: true,
                nest: true
            });

            if (oldest_score) {
                oldest_possible_date = oldest_score.date_played;
                //round to nearest interval
                switch (period) {
                    case 'h':
                        oldest_possible_date.setMinutes(0);
                        oldest_possible_date.setSeconds(0);
                        oldest_possible_date.setMilliseconds(0);
                        break;
                    case 'd':
                        oldest_possible_date.setHours(0);
                        oldest_possible_date.setMinutes(0);
                        oldest_possible_date.setSeconds(0);
                        oldest_possible_date.setMilliseconds(0);
                        break;
                    case 'm':
                        oldest_possible_date.setDate(1);
                        oldest_possible_date.setHours(0);
                        oldest_possible_date.setMinutes(0);
                        oldest_possible_date.setSeconds(0);
                        oldest_possible_date.setMilliseconds(0);
                        break;
                    case 'y':
                        oldest_possible_date.setMonth(0);
                        oldest_possible_date.setDate(1);
                        oldest_possible_date.setHours(0);
                        oldest_possible_date.setMinutes(0);
                        oldest_possible_date.setSeconds(0);
                        oldest_possible_date.setMilliseconds(0);
                        break;
                }

                //to string
                oldest_possible_date = oldest_possible_date.toISOString();
            }
        }

        const query = `
        WITH time_entries AS (
            SELECT 
                generate_series(
                    date_trunc('${period_long}', ${all_time ? `CAST('${oldest_possible_date}' as timestamp)` : `${db_now} - INTERVAL '${interval} ${period_long}s'`}),
                    date_trunc('${period_long}', ${db_now}),
                    INTERVAL '1 ${period_long}s'
                ) AS time_interval
        )
        
        SELECT ARRAY(
            SELECT 
                json_build_object(
                    'timestamp', t.time_interval,
                    'entry_count', COALESCE(COUNT(s.date_played), 0),
                    'entry_count_SS', COALESCE(COUNT(CASE WHEN s.rank = 'XH' OR s.rank = 'X' THEN s.date_played END), 0),
                    'entry_count_S', COALESCE(COUNT(CASE WHEN s.rank = 'SH' OR s.rank = 'S' THEN s.date_played END), 0),
                    'entry_count_A', COALESCE(COUNT(CASE WHEN s.rank = 'A' THEN s.date_played END), 0),
                    'entry_count_B', COALESCE(COUNT(CASE WHEN s.rank = 'B' THEN s.date_played END), 0),
                    'entry_count_C', COALESCE(COUNT(CASE WHEN s.rank = 'C' THEN s.date_played END), 0),
                    'entry_count_D', COALESCE(COUNT(CASE WHEN s.rank = 'D' THEN s.date_played END), 0),
                    'entry_count_score', COALESCE(SUM(score), 0)
                ) AS entry
            FROM time_entries t
            LEFT JOIN scores s 
                ON date_trunc('${period_long}', s.date_played) = t.time_interval
                ${all_time ? '' : `AND s.date_played >= date_trunc('${period_long}', ${db_now} - INTERVAL '${interval} ${period_long}s')`}
            GROUP BY t.time_interval
            ORDER BY t.time_interval
        ) AS time_entries;
    `;

        console.log(query);

        const client = new Client({ user: process.env.ALT_DB_USER, host: process.env.ALT_DB_HOST, database: process.env.ALT_DB_DATABASE, password: process.env.ALT_DB_PASSWORD, port: process.env.ALT_DB_PORT });
        await client.connect();

        const { rows } = await client.query(query);
        await client.end();
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

const today_categories = [
    {
        name: 'Clears',
        query: `COUNT(*)`
    },
    {
        name: 'SS',
        query: `COUNT(*) FILTER (WHERE rank = 'XH' OR rank = 'X')`
    },
    {
        name: 'Total PP',
        query: `SUM(pp)`,
        round: true,
        formatter: `{value}pp`
    },
    {
        name: 'Score',
        query: `SUM(score)`
    },
]
router.get('/today', cache('10 minutes'), async function (req, res, next) {
    try {
        const users_limit = req.query.users_limit || 10;
        const specific_user_id = req.query.user_id || undefined;

        let query = '';

        today_categories.forEach((category, index) => {
            const base_query = `
            SELECT
            user_id, 
            ${category.round ? `ROUND(${category.query})` : category.query} AS value, 
            ${category.formatter ? `'${category.formatter}'` : `'{value}'`} AS value_formatter,
            '${category.name}' AS category,
            RANK() OVER (ORDER BY ${category.query} DESC) AS rank
            FROM scores
        `;

            const top_query = `
            ${base_query}
            WHERE date_played >= date_trunc('day',${db_now})
            AND (user_id IN (SELECT user_id FROM users2))
            GROUP BY user_id
            ORDER BY value DESC
        `;

            const user_specific_query = `
            WITH t AS (
                ${top_query}
            )
            SELECT * FROM t
            WHERE user_id = ${specific_user_id}
            AND rank > ${users_limit}
        `;

            query += `
            (
                (
                    ${top_query}
                    LIMIT ${users_limit}
                )

                ${specific_user_id && !isNaN(specific_user_id) ? `
                    UNION
                    (
                        ${user_specific_query}
                    )
                ` : ''}
            )
            ${index !== today_categories.length - 1 ? 'UNION' : ''}`;
        });

        const result = await Databases.osuAlt.query(query);

        const data = result?.[0];

        const user_ids = data.map(row => row.user_id);
        const client = request(req.app);
        const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true&skipOsuData=true`).set('Origin', req.headers.origin || req.headers.host);

        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            row.rank = parseInt(row.rank);
            row.user = _.cloneDeep(users.body.find(user => user.alt.user_id === row.user_id));
            row.user.alt = undefined;
        }

        //reformat each category into their own array
        const categories = {};

        today_categories.forEach((category, index) => {
            const category_data = data?.filter(row => row.category === category.name);
            //sort
            category_data.sort((a, b) => b.value - a.value);

            //fix dense rankings
            category_data.forEach((row, index) => {
                if (index > 0 && row.rank === category_data[index - 1].rank) {
                    row.rank++;
                }
            });

            categories[category.name] = category_data;
        });

        res.json(categories);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

router.get('/ranking', cache('1 hour'), async function (req, res, next) {
    let user_id, date, rank = undefined;
    let limit = 100;
    let page = 0;
    let sort = 'rank'
    try {
        user_id = req.query.user_id || undefined;
        date = req.query.date || undefined;
        rank = req.query.rank || undefined;
        limit = Number(req.query.limit) || 10000;
        page = Number(req.query.page) || 1;
        sort = req.query.sort || 'rank';
    } catch (e) {
        res.status(400).json({ "error": "Invalid parameters" });
        return;
    }

    let where_clause = {};
    let sort_clause = '';
    if (user_id) { where_clause.osu_id = user_id; }
    if (date) { where_clause.date = date; }
    if (rank) { where_clause.rank = rank; }
    switch (sort) {
        default:
        case 'rank':
            sort_clause = 'rank ASC';
            break;
        case 'rank_gain':
            sort_clause = '(old_rank - rank) DESC';
            break;
        case 'score_gain':
            sort_clause = '(ranked_score - old_ranked_score) DESC';
            break;
    }

    const data = await InspectorHistoricalScoreRank.findAll({
        where: where_clause,
        order: Sequelize.literal(sort_clause),
        limit: limit,
        offset: (page - 1) * limit,
        raw: true,
        nest: true
    });

    if (where_clause.date) {
        //we also want to add the rank of the user in the previous day
        try {
            data.forEach(row => {
                row.inspector_user = {
                    known_username: row.username,
                    osu_id: row.osu_id,
                    roles: [],
                };
            });

            const osuUsers = await GetOsuUsers(data.map(row => row.osu_id));

            const inspectorUsers = await InspectorUser.findAll({
                where: { osu_id: data.map(row => row.osu_id) },
                include: [
                    {
                        model: InspectorRole,
                        attributes: ['id', 'title', 'description', 'color', 'icon', 'is_visible', 'is_admin', 'is_listed'],
                        through: { attributes: [] },
                        as: 'roles'
                    }
                ]
            });

            if (osuUsers && inspectorUsers) {
                osuUsers.forEach(osu_user => {
                    const row = data.find(row => row.osu_id === osu_user.id);
                    row.osu_user = osu_user;
                });
            }

            if (inspectorUsers) {
                inspectorUsers.forEach(inspector_user => {
                    const row = data.find(row => row.osu_id === inspector_user.osu_id);
                    row.inspector_user = inspector_user;
                });
            }
        } catch (e) {
            console.error(e);
        }
    }

    res.json(data);
});

router.get('/ranking/dates', cache('1 hour'), async function (req, res, next) {
    try {
        const data = await InspectorHistoricalScoreRank.findAll({
            attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('date')), 'date']],
            raw: true,
            nest: true
        });

        let dates = [];
        data.forEach(row => {
            dates.push(row.date);
        });

        res.json(dates);
    } catch (e) {
        console.error(e);

        res.json([])
    }
});

router.get('/ranking/stats', cache('1 hour'), async function (req, res, next) {
    let daily_total_ranked_score;
    try {
        //get the total ranked score of each unique day
        daily_total_ranked_score = await InspectorHistoricalScoreRank.findAll({
            attributes: [
                'date',
                [Sequelize.fn('SUM', Sequelize.col('ranked_score')), 'total_ranked_score']
            ],
            group: ['date'],
            raw: true,
            nest: true
        });
    } catch (e) {
        console.error(e);
    }

    res.json({
        daily_total_ranked_score: daily_total_ranked_score ?? []
    });
});

router.get('/milestones/user/:id', cache('1 hour'), async function (req, res, next) {
    const user_id = req.params.id;
    const limit = req.query.limit || 10;
    const offset = req.query.offset || 0;

    const milestones = await InspectorUserMilestone.findAll({
        where: {
            user_id: user_id
        },
        order: [
            ['time', 'DESC']
        ],
        limit: limit,
        offset: offset,
        raw: true,
        nest: true,
        include: [
            {
                model: InspectorOsuUser,
                as: 'user',
                required: true
            }, {
                model: InspectorUser,
                as: 'inspector_user'
            }
        ]
    });
    res.json(milestones);
});

router.get('/milestones', cache('1 hour'), async function (req, res, next) {
    let limit = 100;
    let page = 0;
    try {
        limit = Number(req.query.limit) || 10000;
        page = Number(req.query.page) || 1;
    } catch (e) {
        res.status(400).json({ "error": "Invalid parameters" });
        return;
    }

    const milestones = await InspectorUserMilestone.findAll({
        order: [
            ['time', 'DESC']
        ],
        limit: limit,
        offset: (page - 1) * limit,
        raw: true,
        nest: true,
        include: [
            {
                model: InspectorOsuUser,
                as: 'user',
                required: true
            }
        ]
    });

    if (limit && limit <= 100) {
        const user_ids = milestones.map(milestone => milestone.user_id);
        const client = request(req.app);
        const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true&skipAltData=true`).set('Origin', req.headers.origin || req.headers.host);

        for (const milestone of milestones) {
            const _user = _.cloneDeep(users.body.find(user => user.osu.id === milestone.user_id) ?? {});
            milestone.inspector_user = _user.inspector_user;
        }
    }

    res.json(milestones);
});

router.get('/milestones/count', cache('1 hour'), async function (req, res, next) {
    const count = await InspectorUserMilestone.count();
    res.json(count);
});

router.get('/milestones/stats', cache('1 hour'), async function (req, res, next) {
    let recorded_milestones, recorded_milestones_today, users;
    try {
        recorded_milestones = await InspectorUserMilestone.count();
        recorded_milestones_today = await InspectorUserMilestone.count({
            where: {
                time: {
                    //mariaDB
                    [Op.gte]: Sequelize.literal(`DATE(NOW())`)
                }
            }
        });
        users = await InspectorOsuUser.count();
    } catch (err) {
        console.error(err);
    }
    res.json({
        recorded_milestones: recorded_milestones ?? 0,
        recorded_milestones_today: recorded_milestones_today ?? 0,
        users: users ?? 0
    });
});
router.get('/monthly_score_farmers', cache('1 hour'), async function (req, res, next) {
    let data = [];
    try{
        const result = await InspectorScoreStat.findAll({
            where: {
                key: 'monthly_score_farmers'
            },
            raw: true,
            nest: true
        });

        // data = result?.[0]?.value ?? [];
        data = result?.map(row => {
            return JSON.parse(row.value);
        });

        let user_ids = data.map(row => row.user_id);
        //unique user ids only
        user_ids = [...new Set(user_ids)];
        const client = request(req.app);
        const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true&skipOsuData=true`).set('Origin', req.headers.origin || req.headers.host);

        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            row.user = _.cloneDeep(users.body.find(user => user.alt.user_id === row.user_id));
            row.user.alt = undefined;
        }
    }catch(e){
        console.error(e);
    }
    res.json(data);
});

module.exports = router;
