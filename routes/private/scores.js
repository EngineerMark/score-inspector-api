var express = require('express');
var apicache = require('apicache');
var router = express.Router();
const { GetBestScores, score_columns, score_columns_full, beatmap_columns, GetBeatmapScores } = require('../../helpers/osualt');
const { getBeatmaps, getCompletionData, DefaultInspectorUser } = require('../../helpers/inspector');
const { AltScore, AltBeatmap, AltModdedStars, AltBeatmapPack, InspectorModdedStars, InspectorScoreStat, AltBeatmapEyup, Databases, AltBeatmapSSRatio, AltTopScore, InspectorHistoricalScoreRank, InspectorUser, InspectorRole, InspectorUserMilestone, InspectorOsuUser, InspectorPerformanceRecord, InspectorBeatmap, AltBeatmapMaxScoreNomod, AltUser, InspectorClanMember, InspectorClan } = require('../../helpers/db');
const { Op, Sequelize } = require('sequelize');
const { CorrectedSqlScoreMods, CorrectMod, ModsToString, db_now, all_mods_short } = require('../../helpers/misc');
const request = require("supertest");
const { GetOsuUsers } = require('../../helpers/osu');
const fastJson = require('fast-json-parse');
var _ = require('lodash');
const { parse } = require('dotenv');
const util = require('util');

require('dotenv').config();
let cache = apicache.middleware;

async function GetScores(req, score_attributes = undefined, beatmap_attributes = undefined) {
    const include_modded = req.query.ignore_modded_stars !== 'true';
    const _mods = req.query.mods;
    const split_mods = _mods ? _mods.split(',') : [];
    const mods_bit_values = split_mods.map(mod => all_mods_short[mod]);
    let _enabled_mods = {};
    if (req.query.mods) {
        //we do NOT correct any mods here
        //enabled_mods is a varchar in database, keep that in mind
        if (req.query.mods === 'NM') {
            _enabled_mods[Op.eq] = '0';
        } else {
            if (req.query.mods_usage === 'all') {
                //enabled_mods must contain all mods
                _enabled_mods[Op.eq] = '' + mods_bit_values.reduce((ps, a) => ps + a, 0);
            } else {
                //enabled_mods must contain any of the mods
                //Op.bitwiseAnd is not a thing, use raw sql for this
                _enabled_mods[Op.or] = mods_bit_values.map(mod => {
                    return Sequelize.literal(`(CAST("Score"."enabled_mods" AS int) & ${mod}) = ${mod}`);
                });
            }
        }
    }
    let scores = await AltScore.findAll({
        where: {
            ...req.params.id ? { user_id: req.params.id } : {},
            ...req.query.min_score || req.query.max_score ? { score: { [Op.between]: [req.query.min_score ?? 0, req.query.max_score ?? 100000000000] } } : {},
            ...req.query.min_pp || req.query.max_pp ? { pp: { [Op.between]: [req.query.min_pp ?? 0, req.query.max_pp ?? 100000000000] } } : {},
            ...req.query.min_acc || req.query.max_acc ? { accuracy: { [Op.between]: [req.query.min_acc ?? 0, req.query.max_acc ?? 101] } } : {},
            ...req.query.min_combo || req.query.max_combo ? { combo: { [Op.between]: [req.query.min_combo ?? 0, req.query.max_combo ?? 1000000000] } } : {},
            //for mods we check if enabled_mods & mod == mod, depending on mods_usage we use AND or OR, we do NOT correct the mods here
            ...req.query.mods ? {
                enabled_mods: _enabled_mods
            } : {},
            ...req.query.grades ? { rank: { [Op.in]: req.query.grades.split(',') } } : {},
            ...req.query.min_played_date || req.query.max_played_date ? { date_played: { [Op.between]: [req.query.min_played_date ?? '2000-01-01', req.query.max_played_date ?? '2100-01-01'] } } : {},
        },
        order: [
            //order by pp desc default
            ...(req.query.order ? [[req.query.order, req.query.order_dir ?? 'DESC']] : []),
            ['pp', 'DESC']
        ],
        limit: req.query.limit ?? undefined,
        offset: req.query.offset ?? undefined,
        include: [
            {
                model: AltBeatmap,
                as: 'beatmap',
                where: {
                    ...(req.query.approved ? { [Op.or]: req.query.approved.split(',').map(approved => { return { approved: approved } }) } : {}),
                    ...(req.query.min_ar || req.query.max_ar ? { ar: { [Op.between]: [req.query.min_ar ?? 0, req.query.max_ar ?? 1000000000] } } : {}),
                    ...(req.query.min_od || req.query.max_od ? { od: { [Op.between]: [req.query.min_od ?? 0, req.query.max_od ?? 1000000000] } } : {}),
                    ...(req.query.min_hp || req.query.max_hp ? { hp: { [Op.between]: [req.query.min_hp ?? 0, req.query.max_hp ?? 1000000000] } } : {}),
                    ...(req.query.min_length || req.query.max_length ? { length: { [Op.between]: [req.query.min_length ?? 0, req.query.max_length ?? 1000000000] } } : {}),
                    //approved: { [Op.in]: [1, 2, req.query.include_loved === 'true' ? 4 : 1] },
                    ...(req.query.beatmap_id ? { beatmap_id: req.query.beatmap_id } : {}), //for development purposes
                    ...(req.query.min_approved_date || req.query.max_approved_date ? { approved_date: { [Op.between]: [req.query.min_approved_date ?? '2000-01-01', req.query.max_approved_date ?? '2100-01-01'] } } : {}),
                },
                required: true,
                include: [
                    ...(include_modded ? [
                        {
                            model: AltModdedStars,
                            as: 'modded_sr',
                            required: true,
                            where: {
                                [Op.and]: {
                                    mods_enum: {
                                        [Op.eq]: Sequelize.literal(CorrectedSqlScoreMods)
                                    },
                                    beatmap_id: {
                                        [Op.eq]: Sequelize.literal('beatmap.beatmap_id')
                                    },
                                    ...(req.query.min_stars || req.query.max_stars ? { star_rating: { [Op.between]: [req.query.min_stars ?? 0, req.query.max_stars ?? 1000000000] } } : {}),
                                }
                            }
                        }] : [])
                ],
            },
            ...(!req.params.id ? [{
                model: AltUser,
                as: 'user',
                required: true,
                where: {
                    ...(req.query.min_rank || req.query.max_rank ? { global_rank: { [Op.between]: [req.query.min_rank ?? 0, req.query.max_rank ?? 1000000000] } } : {}),
                    //country is comma separated, so we split it, if 'world' is in the array, we don't filter by country at all
                    //entire country code is capitalized in the database
                    ...(req.query.country && req.query.country !== 'world' ? { country_code: { [Op.or]: req.query.country.split(',').map(country => { return { [Op.iLike]: `%${country}%` } }) } } : {}),
                }
            }] : []),
            ...(req.params.id ?
                [{
                    model: AltTopScore,
                    as: 'top_score',
                    where: {
                        user_id: req.params.id
                    },
                    required: false,
                }] : [])
        ],
        nest: true,
        logging: console.log
    });
    console.log(util.inspect(_enabled_mods, { showHidden: false, depth: null, colors: true }));

    scores = JSON.parse(JSON.stringify(scores));

    if (!req.params.id) {
        //add user data after the fact, since we don't need it in the massive query
        const inspectorUsers = await InspectorUser.findAll({
            where: { osu_id: scores.map(row => row.user_id) },
            includes: [
                {
                    model: InspectorClanMember,
                    attributes: ['osu_id', 'clan_id', 'join_date', 'pending'],
                    as: 'clan_member',
                    include: [{
                        model: InspectorClan,
                        attributes: ['id', 'name', 'tag', 'color', 'creation_date', 'description', 'owner'],
                        as: 'clan',
                    }]
                }
            ]
        });
        // scores.forEach(score => {
        //     // score.inspector_user = inspectorUsers.find(user => user.osu_id === score.user_id) ?? DefaultInspectorUser();
        //     score.inspector_user = DefaultInspectorUser(inspectorUsers.find(user => user.osu_id === score.user_id), score.user.username, score.user_id);
        // });
        for (let i = 0; i < scores.length; i++) {
            scores[i].inspector_user = DefaultInspectorUser(inspectorUsers.find(user => user.osu_id === scores[i].user_id), scores[i].user.username, scores[i].user_id);
        }
    }

    if (req.query.include_packs !== 'false') {
        scores = JSON.parse(JSON.stringify(scores));
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
    }

    return scores;
}

router.get('/all', cache('1 hour'), async function (req, res, next) {
    try {
        const page = req.query.page ?? 1;
        const limit = req.query.limit ?? 1000;
        const offset = (page - 1) * limit;

        const _req = {
            query: {
                ...req.query,
                limit: limit,
                offset: offset,
                id: undefined
            },
            params: {
                id: undefined
            }
        }
        const rows = await GetScores(_req);
        res.json(rows);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e });
    }
});

/* Get the entire list of scores of a user */
router.get('/user/:id', cache('1 minute'), async function (req, res, next) {
    try {
        const rows = await GetScores(req);
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
        const scores = await GetScores(req, ['beatmap_id'], ['beatmap_id', 'approved_date', 'length', 'stars', 'cs', 'ar', 'od', 'hp', 'approved', 'max_combo']);
        const beatmaps = await getBeatmaps({
            ...req.query, customAttributeSet: [
                'beatmap_id',
                'cs',
                'ar',
                'od',
                'hp',
                'approved_date',
                'stars',
                'length',
                'maxcombo',
            ]
        });
        const data = getCompletionData(scores, beatmaps);
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

        // const pp_records = await InspectorPerformanceRecord.findAll({
        //     order: [
        //         ['pp', 'DESC']
        //     ],
        //     raw: true,
        //     nest: true
        // });

        // if (pp_records) {
        //     //unique user ids
        //     const user_ids = pp_records.map(record => record.user_id);
        //     const beatmap_ids = pp_records.map(record => record.beatmap_id);

        //     const client = request(req.app);
        //     const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true`).set('Origin', req.headers.origin || req.headers.host);

        //     //find scores for each pp_record
        //     const beatmap_user_pairs = pp_records.map(record => {
        //         return {
        //             beatmap_id: record.beatmap_id,
        //             user_id: record.user_id
        //         }
        //     });

        //     const scores = await AltScore.findAll({
        //         where: {
        //             [Op.or]: beatmap_user_pairs
        //         },
        //         raw: true,
        //         nest: true,
        //         include: [
        //             {
        //                 model: AltBeatmap,
        //                 as: 'beatmap',
        //                 required: true,
        //                 include: [
        //                     {
        //                         model: AltModdedStars,
        //                         as: 'modded_sr',
        //                         where: {
        //                             mods_enum: {
        //                                 [Op.eq]: Sequelize.literal(CorrectedSqlScoreMods)
        //                             },
        //                             beatmap_id: {
        //                                 [Op.eq]: Sequelize.literal('beatmap.beatmap_id')
        //                             }
        //                         }
        //                     }
        //                 ]
        //             }
        //         ]
        //     });

        //     pp_records.forEach(record => {
        //         record.score = scores.find(score => score.beatmap_id === record.beatmap_id && score.user_id === record.user_id);
        //         record.user = users.body.find(user => user.osu.id === record.user_id);
        //     });

        //     //remove entries if the score is not found
        //     let pp_records_filtered = pp_records.filter(record => record.score);

        //     pp_records_filtered.sort((a, b) => b.pp - a.pp).reverse();

        //     data.pp_records = pp_records_filtered ?? [];
        // }
    } catch (e) {
        console.error(e);
    }

    res.json(data);
});

router.get('/most_played', cache('1 hour'), async function (req, res, next) {
    try {
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

        // const { rows } = await client.query(query);
        const [rows] = await Databases.osuAlt.query(query);
        // await client.end();
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
                    'entry_count', COALESCE(COUNT(1), 0),
                    'entry_count_SS', COALESCE(COUNT(CASE WHEN s.rank = 'XH' OR s.rank = 'X' THEN 1 END), 0),
                    'entry_count_S', COALESCE(COUNT(CASE WHEN s.rank = 'SH' OR s.rank = 'S' THEN 1 END), 0),
                    'entry_count_A', COALESCE(COUNT(CASE WHEN s.rank = 'A' THEN 1 END), 0),
                    'entry_count_B', COALESCE(COUNT(CASE WHEN s.rank = 'B' THEN 1 END), 0),
                    'entry_count_C', COALESCE(COUNT(CASE WHEN s.rank = 'C' THEN 1 END), 0),
                    'entry_count_D', COALESCE(COUNT(CASE WHEN s.rank = 'D' THEN 1 END), 0),
                    'entry_count_score', COALESCE(SUM(score), 0)
                ) AS entry
            FROM time_entries t
            LEFT JOIN scores s 
                ON date_trunc('${period_long}', s.date_played) = t.time_interval
                ${all_time ? '' : `AND s.date_played >= date_trunc('${period_long}', ${db_now} - INTERVAL '${interval} ${period_long}s')`}
            WHERE s.date_played >= date_trunc('${period_long}', ${all_time ? `CAST('${oldest_possible_date}' as timestamp)` : `${db_now} - INTERVAL '${interval} ${period_long}s'`})
            GROUP BY t.time_interval
            ORDER BY t.time_interval
        ) AS time_entries;
    `;

        const [rows] = await Databases.osuAlt.query(query);
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
        console.time('today_query');
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
                FROM scores`;

            const top_query = `
                ${base_query}
                WHERE date_played >= date_trunc('day',${db_now})
                GROUP BY user_id
                ORDER BY value DESC `;

            const user_specific_query = `
                WITH t AS (
                    ${top_query}
                )
                SELECT * FROM t
                WHERE user_id = ${specific_user_id}
                AND rank > ${users_limit}`;

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

        console.timeEnd('today_query');
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
                    },
                    {
                        model: InspectorClanMember,
                        attributes: ['osu_id', 'clan_id', 'join_date', 'pending'],
                        as: 'clan_member',
                        include: [{
                            model: InspectorClan,
                            attributes: ['id', 'name', 'tag', 'color', 'creation_date', 'description', 'owner'],
                            as: 'clan',
                        }]
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

router.get('/milestones/user/:id', cache('5 minutes'), async function (req, res, next) {
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

router.get('/milestones', cache('5 minutes'), async function (req, res, next) {
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

router.get('/milestones/count', cache('5 minutes'), async function (req, res, next) {
    const count = await InspectorUserMilestone.count();
    res.json(count);
});

router.get('/milestones/stats', cache('5 minutes'), async function (req, res, next) {
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
router.get('/monthly_farmers/:data', cache('1 hour'), async function (req, res, next) {
    let data = [];
    try {
        const result = await InspectorScoreStat.findAll({
            where: {
                key: `monthly_${req.params.data}_farmers`
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
    } catch (e) {
        console.error(e);
    }
    res.json(data);
});
router.get('/monthly_farmers/log/:data', cache('1 hour'), async function (req, res, next) {
    let data = [];
    try {
        const result = await InspectorScoreStat.findOne({
            where: {
                key: `monthly_${req.params.data}_farmers_log`
            },
            raw: true,
            nest: true
        });

        data = result?.value ?? [];
        data = JSON.parse(data);

        let user_ids = data.map(row => [row.old_user_id, row.new_user_id]).flat();
        user_ids = [...new Set(user_ids)];
        const client = request(req.app);
        const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true&skipOsuData=true`).set('Origin', req.headers.origin || req.headers.host);

        for (let index = 0; index < data.length; index++) {
            const row = data[index];
            row.old_user = _.cloneDeep(users.body.find(user => user.alt.user_id === row.old_user_id));
            row.old_user.alt = undefined;
            row.new_user = _.cloneDeep(users.body.find(user => user.alt.user_id === row.new_user_id));
            row.new_user.alt = undefined;
        }

        // data = result?.[0]?.value ?? [];
        // data = result?.map(row => {
        //     return JSON.parse(row.value);
        // });

        // let user_ids = data.map(row => row.user_id);
        // //unique user ids only
        // user_ids = [...new Set(user_ids)];
        // const client = request(req.app);
        // const users = await client.get(`/users/full/${user_ids.join(',')}?force_array=false&skipDailyData=true&skipOsuData=true`).set('Origin', req.headers.origin || req.headers.host);

        // for (let index = 0; index < data.length; index++) {
        //     const row = data[index];
        //     row.user = _.cloneDeep(users.body.find(user => user.alt.user_id === row.user_id));
        //     row.user.alt = undefined;
        // }
    } catch (e) {
        console.error(e);
    }
    res.json(data);
});

module.exports = router;
